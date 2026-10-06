import { parseCzechAmount } from '@orbit-api/lib/parsers/csv/numbers';
import { parseCzechDate } from '@orbit-api/lib/parsers/csv/dates';
import { CsvStructureError, type ParsedTransaction } from '@orbit-api/lib/parsers/csv/types';

/**
 * Moneta "Výpis ke kreditní kartě" (credit card statement) PDF.
 *
 * Unlike the XML bank statement, this has no machine-readable structure at
 * all — no schema, no declared transaction count. Parses the already
 * -extracted text (extraction is a separate step, same split as
 * `lib/parsers/csv/decode.ts` / `orlen-receipt.ts`).
 *
 * Verified against a real August statement: the label/value pairs in the
 * header ("Jak mám zaplatit", "Zúčtování aktuálního období" etc.) extract as
 * two blocks — every label line, then every value line, in the same order —
 * not interleaved label-value-label-value. Each transaction row extracts as
 * three consecutive lines: posting date, valuta date, then
 * "<description> <amount>" on one line.
 *
 * Pure: no database, no network, no clock.
 */

// Digits plus every thousands-separator whitespace variant Moneta's PDF
// export can use: plain space, non-breaking space (U+00A0), narrow no-break
// space (U+202F), thin space (U+2009) — the same set numbers.ts's
// parseCzechAmount already tolerates when parsing the value. A real October
// statement used the narrow no-break space where August's used a plain
// non-breaking space, and these patterns only covered the latter, so the
// statement failed to parse at all despite being well-formed.
const AMOUNT_TOKEN = '-?[ \\t]?[\\d    ]+,\\d{2}';

/** Posting date, then valuta date, then description + trailing Kč amount. */
const ROW_PATTERN = new RegExp(`^(\\d{2}\\.\\d{2}\\.\\d{4})\\n\\d{2}\\.\\d{2}\\.\\d{4}\\n(.+?)[ \\t]+(${AMOUNT_TOKEN})[ \\t]*$`, 'gm');

const PERIOD_BLOCK_PATTERN =
  /Výpis za období:\s*\nVýpis ke dni:\s*\nPředchozí výpis ze dne:\s*\nStrana:\s*\n[\d.-]+\s*\n(\d{2}\.\d{2}\.\d{4})\s*\n(\d{2}\.\d{2}\.\d{4})?\s*\n\d+\/\d+/;
const CARD_LAST4_PATTERN = /karta číslo\s+(?:x{4}\s+){3}(\d{4})/i;
const CONTRACT_NUMBER_PATTERN = /Na účet číslo\s*\nVariabilní symbol \(Číslo Vaší smlouvy\)\s*\n[\d/]+\s*\n(\d+)/;
/** The statement's own document reference, e.g. "BM/V62608310201593163" — this document's equivalent of the XML statement's `@number`. */
const STATEMENT_NUMBER_PATTERN = /\b(BM\/V\d+)\b/;
const OPENING_BALANCE_PATTERN = new RegExp(`Počáteční zůstatek\\s*\\n[\\s\\S]*?\\n(${AMOUNT_TOKEN})`);
// A card that ends a period owing money states "Celkem dlužná částka"
// (negative). A card that ends in credit — more paid in than spent — omits
// that line entirely and states "Přeplatek" instead (positive, no minus
// sign in the document; a real October statement hit exactly this case).
// Both are read the same way: whichever label the document actually has
// supplies the signed closing balance.
const CLOSING_BALANCE_DEBT_PATTERN = new RegExp(`Celkem dlužná částka\\s+(${AMOUNT_TOKEN})`);
const CLOSING_BALANCE_OVERPAYMENT_PATTERN = new RegExp(`Přeplatek:?\\s+(${AMOUNT_TOKEN})`);

export interface CreditCardStatementPeriod {
  /** Inclusive end, and the date the closing balance is true as of. */
  to: string;
  /**
   * Exclusive start: the previous statement's closing date. `null` on the
   * card's first-ever statement — same "no prior coverage" convention as
   * `lib/parsers/xml/moneta-statement.ts`'s `StatementPeriod.from`. Unverified
   * against a real first statement (none was available to check against), so
   * this falls back to `null` whenever the value doesn't parse rather than
   * guessing.
   */
  from: string | null;
}

export interface CreditCardStatementParseResult {
  provider: 'MONETA';
  /** The document's own reference, e.g. "BM/V62608310201593163". */
  number: string;
  /** The card's contract number ("Variabilní symbol"), matched against `Account.externalId`. */
  sourceAccountId: string;
  /** Last four digits of the card, matched against `Account.cardLast4`. */
  sourceCardLast4: string;
  period: CreditCardStatementPeriod;
  openingBalance: string;
  closingBalance: string;
  transactions: ParsedTransaction[];
  /** Problems found by checking the document against itself. */
  warnings: string[];
}

function requireMatch(pattern: RegExp, text: string, label: string): RegExpExecArray {
  const match = pattern.exec(text);

  if (!match) {
    throw new CsvStructureError(`Ve výpisu ke kreditní kartě se nepodařilo najít: ${label}`);
  }

  return match;
}

/** Parses "01.08.2026" (day.month.year, no separators between the two dot-formats) into ISO. */
function toIsoDate(raw: string): string {
  return parseCzechDate(raw).toISOString().slice(0, 10);
}

export function parseMonetaCreditCardStatement(text: string): CreditCardStatementParseResult {
  if (!/Výpis ke kreditní kartě/.test(text)) {
    throw new CsvStructureError('Není výpis ke kreditní kartě Moneta');
  }

  const number = requireMatch(STATEMENT_NUMBER_PATTERN, text, 'číslo dokladu')[1] ?? '';
  const periodMatch = requireMatch(PERIOD_BLOCK_PATTERN, text, 'období výpisu');
  const cardLast4 = requireMatch(CARD_LAST4_PATTERN, text, 'poslední čtyři číslice karty')[1] ?? '';
  const sourceAccountId = requireMatch(CONTRACT_NUMBER_PATTERN, text, 'variabilní symbol (číslo smlouvy)')[1] ?? '';
  const openingBalance = parseCzechAmount(requireMatch(OPENING_BALANCE_PATTERN, text, 'počáteční zůstatek')[1] ?? '0');
  const closingBalanceRaw = CLOSING_BALANCE_DEBT_PATTERN.exec(text)?.[1] ?? CLOSING_BALANCE_OVERPAYMENT_PATTERN.exec(text)?.[1];

  if (!closingBalanceRaw) {
    throw new CsvStructureError('Ve výpisu ke kreditní kartě se nepodařilo najít: celkem dlužná částka nebo přeplatek');
  }

  const closingBalance = parseCzechAmount(closingBalanceRaw);

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const match of text.matchAll(ROW_PATTERN)) {
    const [, dateRaw, descriptionRaw, amountRaw] = match;

    if (!dateRaw || !descriptionRaw || !amountRaw) {
      continue;
    }

    const description = descriptionRaw.trim();

    try {
      transactions.push({
        // No per-row reference exists anywhere in this document (unlike the
        // bank CSV/XML, which both carry one) — every row falls back to the
        // ATTRIBUTES idempotency strategy. Two identical same-merchant
        // same-day charges would collide; there is no way around that here.
        externalId: null,
        date: parseCzechDate(dateRaw),
        amount: parseCzechAmount(amountRaw),
        currency: 'CZK',
        merchant: description,
        description,
        sourceCategory: null,
        counterAccount: null,
        raw: { date: dateRaw, description, amount: amountRaw },
      });
    } catch (error: unknown) {
      const reason = error instanceof Error ? error.message : 'Nečitelný řádek';

      warnings.push(`Řádek "${description}" se nepodařilo přečíst: ${reason}`);
    }
  }

  if (transactions.length === 0) {
    throw new CsvStructureError('Ve výpisu nebyla nalezena žádná transakce — formát výpisu se možná změnil');
  }

  // The document declares no transaction count (unlike the XML bank
  // statement's trn-cnt), so this sum check is the only available integrity
  // check: it would catch a row the extraction silently missed or misread.
  const total = transactions.reduce((sum, t) => sum + Number(parseCzechAmount(t.amount)), 0);
  const expectedClosing = Number(openingBalance) + total;

  if (Math.abs(expectedClosing - Number(closingBalance)) > 0.01) {
    warnings.push(
      `Počáteční zůstatek a transakce dávají ${expectedClosing.toFixed(2)}, výpis uvádí konečnou dlužnou částku ${closingBalance}`,
    );
  }

  return {
    provider: 'MONETA',
    number,
    sourceAccountId,
    sourceCardLast4: cardLast4,
    period: {
      to: toIsoDate(periodMatch[1] ?? ''),
      from: periodMatch[2] ? toIsoDate(periodMatch[2]) : null,
    },
    openingBalance,
    closingBalance,
    transactions,
    warnings,
  };
}
