import { parseCzechAmount } from '@/lib/parsers/csv/numbers';
import { parseCzechDate } from '@/lib/parsers/csv/dates';
import { CsvStructureError, type ParsedTransaction } from '@/lib/parsers/csv/types';
import { normalizeSourceReference } from '@/lib/parsers/reference';
import { sumAmounts, toMinorUnits, fromMinorUnits, type StatementParseResult } from '@/lib/parsers/xml/moneta-statement';

/**
 * Moneta checking/savings account statement PDF ("Výpis z běžného účtu" /
 * "Výpis ze spořicího účtu") — the automatic statement that arrives by
 * e-mail, as opposed to the XML export that requires manually pulling it
 * from the banking portal.
 *
 * Unlike the credit card statement, this document carries the same
 * self-verifying information the XML does (declared count, declared
 * turnovers, opening/closing balance) and — critically — a real per-row
 * reference ("Kód transakce"), verified byte-for-byte identical to the XML
 * statement's `@id` for the same real transaction (the savings account's
 * 125000 CZK transfer: XML `id="260820XSB4228315073"`, this PDF's
 * `Kód transakce` for the same row is the same string). So this produces
 * the same `StatementParseResult` the XML parser does, and rows use the
 * real EXTERNAL_ID idempotency strategy — no cross-format ATTRIBUTES
 * fallback needed the way the reference-less credit card PDF requires.
 *
 * Parses the already-extracted text (extraction is a separate step, same
 * split as the other PDF/CSV parsers). Pure: no database, no network, no
 * clock.
 */

/** Trailing amount: optional "- ", digits with optional space-thousands, comma, 2 decimals. */
const AMOUNT_TAIL = '-?\\s?[\\d ]+,\\d{2}';
/**
 * A real transaction code: 6 digits (the row's own date, YYMMDD) followed by
 * 9-16 more letters-and/or-digits — every code observed across real
 * statements is 15-22 characters total (e.g. "260831GTA900001" at the short
 * end, "260821B31299Q3610GH" or the all-digit "260807086129871027" at the
 * long end — codes are not guaranteed to contain a letter, so that can't be
 * the distinguishing feature). Never confusable with a VS/KS/SS value: those
 * are always a *separate*, space-delimited token, so the length overlap
 * with a 10-digit VS doesn't matter — this only ever matches within the one
 * contiguous token immediately after the row's date.
 */
const CODE = '\\d{6}[A-Z0-9]{9,16}';
/**
 * VS only ever appears as a single space-free run of digits. Every VS/KS/SS
 * observed in real statements is at least 4 digits — requiring that here is
 * what keeps a short leading digit-group of the amount itself (e.g. the "1"
 * in "1 500,00") from being misread as a VS token.
 */
const VS = '\\d{4,}';

const LINE1 = new RegExp(`^(\\d{2}\\.\\d{2}\\.\\d{4})\\s+(.*?)\\s*(${CODE})\\s*(${VS})?\\s*(${AMOUNT_TAIL})$`);
const LINE2 = /^(.*?)\s+(\d{2}\.\d{2}\.\d{4})\s*(\d+)?$/;

const HEADER_PATTERN =
  /Číslo výpisu:\s*\nVýpis ze dne:\s*\nPředchozí výpis ze dne:\s*\nPeriodicita výpisu:\s*\nStrana:\s*\n(\S+)\s*\n(\d{2}\.\d{2}\.\d{4})\s*\n\d+\/\d+\s*\n(?:(\d{2}\.\d{2}\.\d{4})\s*\n)?/;
const ACCOUNT_PATTERN =
  /Bankovní spojení:\s*\nČíslo účtu IBAN:\s*\nSWIFT kód BIC:\s*\n([\d /]+)\s*\n/;
const CURRENCY_PATTERN = /Označení měny:\s*(\S+)/;
const BALANCE_BLOCK_PATTERN =
  /Počáteční zůstatek:\s*\nKonečný zůstatek:\s*\n(-?[\d ]+,\d{2})\s*\n(-?[\d ]+,\d{2})/;
const TURNOVER_BLOCK_PATTERN =
  /Obrat kredit:\s*\nObrat debet:\s*\nRoční kreditní obrat:\s*\nRoční debetní obrat:\s*\n(-?[\d ]+,\d{2})\s*\n(-?[\d ]+,\d{2})/;
const DECLARED_COUNT_PATTERN = /Celkový počet transakcí:\s*(\d+)/;

function requireMatch(pattern: RegExp, text: string, label: string): RegExpExecArray {
  const match = pattern.exec(text);

  if (!match) {
    throw new CsvStructureError(`Ve výpisu z účtu se nepodařilo najít: ${label}`);
  }

  return match;
}

function toIsoDate(raw: string): string {
  return parseCzechDate(raw).toISOString().slice(0, 10);
}

export function parseMonetaAccountStatement(text: string): StatementParseResult {
  if (!/Výpis z běžného účtu|Výpis ze spořicího účtu/.test(text)) {
    throw new CsvStructureError('Není výpis z účtu Moneta');
  }

  const header = requireMatch(HEADER_PATTERN, text, 'hlavička výpisu (číslo, datum, období)');
  const number = header[1] ?? '';
  const to = toIsoDate(header[2] ?? '');
  const from = header[3] ? toIsoDate(header[3]) : null;

  const accountMatch = requireMatch(ACCOUNT_PATTERN, text, 'číslo účtu');
  const sourceAccountId = (accountMatch[1] ?? '').trim();

  const currency = requireMatch(CURRENCY_PATTERN, text, 'označení měny')[1] ?? 'CZK';

  const balanceMatch = requireMatch(BALANCE_BLOCK_PATTERN, text, 'počáteční a konečný zůstatek');
  const openingBalance = parseCzechAmount(balanceMatch[1] ?? '0');
  const closingBalance = parseCzechAmount(balanceMatch[2] ?? '0');

  const turnoverMatch = requireMatch(TURNOVER_BLOCK_PATTERN, text, 'obrat kredit/debet');
  // The statement prints debet as a negative figure; the XML/CSV convention
  // (and this parser's self-check below) uses a positive magnitude.
  const creditTurnover = parseCzechAmount(turnoverMatch[1] ?? '0');
  const debitTurnover = parseCzechAmount((turnoverMatch[2] ?? '0').replace('-', ''));

  const declaredCount = Number(requireMatch(DECLARED_COUNT_PATTERN, text, 'celkový počet transakcí')[1] ?? '0');

  const lines = text.split('\n');
  const transactions: ParsedTransaction[] = [];

  for (let i = 0; i < lines.length; i++) {
    const line1 = LINE1.exec((lines[i] ?? '').trim());

    if (!line1) {
      continue;
    }

    const [, , middle, code, , amountRaw] = line1;
    const line2 = LINE2.exec((lines[i + 1] ?? '').trim());

    // Without the posting date on the following line this isn't a real
    // transaction row (or the layout shifted unexpectedly) — skip rather
    // than guess a date.
    if (!line2) {
      continue;
    }

    const merchantPart = (line2[1] ?? '').trim();
    const dateRaw = line2[2] ?? '';
    // A card payment's line 1 has no counterparty account, just a fixed
    // label ("PLATBA KARTOU ONLINE" etc.) — the real merchant is on line 2.
    const counterAccount = middle && /^\d/.test(middle.trim()) ? middle.trim() : null;
    const merchant = merchantPart || (middle ? middle.trim() : null);

    transactions.push({
      externalId: normalizeSourceReference(code),
      date: parseCzechDate(dateRaw),
      amount: parseCzechAmount(amountRaw ?? '0'),
      currency,
      merchant,
      description: middle && counterAccount === null && merchant !== middle.trim() ? middle.trim() : null,
      sourceCategory: null,
      counterAccount,
      raw: { date: dateRaw, code, middle, amount: amountRaw ?? '' },
    });

    i += 1; // consumed line2; LINE3/AV/KI lines are simply skipped by the next LINE1 search
  }

  if (transactions.length === 0) {
    throw new CsvStructureError('Ve výpisu nebyla nalezena žádná transakce — formát výpisu se možná změnil');
  }

  // Moneta reuses one Kód transakce for a same-day interest+tax pair (same
  // issue already handled in the XML parser) — not trustworthy as unique
  // when repeated, so those specific rows fall back to the ATTRIBUTES
  // strategy instead of colliding into one on import.
  const idCounts = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.externalId) {
      idCounts.set(transaction.externalId, (idCounts.get(transaction.externalId) ?? 0) + 1);
    }
  }

  for (const transaction of transactions) {
    if (transaction.externalId && (idCounts.get(transaction.externalId) ?? 0) > 1) {
      transaction.externalId = null;
    }
  }

  const warnings: string[] = [];

  if (transactions.length !== declaredCount) {
    warnings.push(`Výpis hlásí ${declaredCount} transakcí, načteno ${transactions.length}`);
  }

  const totals = sumAmounts(transactions.map((t) => t.amount));

  if (totals.debit !== debitTurnover) {
    warnings.push(`Součet výdajů ${totals.debit} nesedí na deklarovaných ${debitTurnover}`);
  }

  if (totals.credit !== creditTurnover) {
    warnings.push(`Součet příjmů ${totals.credit} nesedí na deklarovaných ${creditTurnover}`);
  }

  const expectedEnd = fromMinorUnits(toMinorUnits(openingBalance) + toMinorUnits(totals.net));

  if (expectedEnd !== closingBalance) {
    warnings.push(`Počáteční zůstatek a pohyby dávají ${expectedEnd}, výpis uvádí konečný ${closingBalance}`);
  }

  return {
    provider: 'MONETA',
    sourceAccountId,
    currency: currency.toUpperCase(),
    period: { number, from, to },
    openingBalance,
    closingBalance,
    debitTurnover,
    creditTurnover,
    declaredCount,
    transactions,
    warnings,
  };
}
