import { XMLParser } from 'fast-xml-parser';
import { z } from 'zod';

import { CsvStructureError, type ParsedTransaction } from '@/lib/parsers/csv/types';
import { normalizeSourceReference } from '@/lib/parsers/reference';

/**
 * Moneta monthly account statement (XML).
 *
 * Not ISO 20022: a Moneta-specific schema. Unlike the CSV movement export it
 * carries the opening and closing balance, the period turnovers and a
 * transaction count — so a statement can verify itself, and the balance anchor
 * no longer has to be typed in by hand.
 *
 * Statement periods are **not** calendar months: the current account closes at
 * month end, the savings account around the 24th. Nothing here assumes
 * otherwise; the period comes from the document.
 */

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  parseAttributeValue: false,
  parseTagValue: false,
  trimValues: true,
});

/** Amounts appear as ".00" as well as "150589.30", so a leading digit is optional. */
const AMOUNT = /^-?\d*\.?\d+$/;

const amountString = z
  .string()
  .trim()
  .refine((value) => AMOUNT.test(value), 'Not a decimal amount')
  // ".00" is not valid input for Decimal.
  .transform((value) => (value.startsWith('.') ? `0${value}` : value.startsWith('-.') ? `-0${value.slice(1)}` : value));

const dateString = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Not an ISO date');

const transactionSchema = z.object({
  '@id': z.string().min(1),
  '@date-eff': dateString,
  '@date-post': dateString.optional(),
  '@amount': amountString,
  '@other-account-number': z.string().optional(),
  '@var-sym': z.string().optional(),
  '@con-sym': z.string().optional(),
  '@spec-sym': z.string().optional(),
  'trn-messages': z.unknown().optional(),
});

const statementSchema = z.object({
  statement: z.object({
    header: z.object({
      stmt: z.object({
        '@number': z.string().min(1),
        '@date': dateString,
        // Empty (not omitted) on an account's first-ever statement — Moneta
        // has no other field naming the period start, so this is the only
        // signal for "no prior coverage exists" (see `period.from` below).
        '@date-previous': z.union([dateString, z.literal('')]),
        '@trn-cnt': z.string(),
      }),
      account: z.object({
        '@number': z.string().min(1),
        '@iban': z.string().optional(),
        '@currency': z.string().length(3),
        'stm-bgn-bal': amountString,
        'debit-tov': amountString,
        'credit-tov': amountString,
      }),
      'stm-bal-end': amountString,
    }),
    transactions: z
      .object({ transaction: z.unknown().optional() })
      .optional(),
  }),
});

export interface StatementPeriod {
  /** Sequence number, e.g. "2026000007". Consecutive statements chain by it. */
  number: string;
  /**
   * Exclusive start: the previous statement's closing date. `null` on an
   * account's first-ever statement — there is no previous one to anchor to,
   * and this project never infers coverage from transaction dates (see
   * `findCoverageGaps` in CLAUDE.md), so that is reported honestly instead
   * of guessed.
   */
  from: string | null;
  /** Inclusive end, and the date the closing balance is true as of. */
  to: string;
}

export interface StatementParseResult {
  provider: 'MONETA';
  sourceAccountId: string;
  currency: string;
  period: StatementPeriod;
  openingBalance: string;
  closingBalance: string;
  debitTurnover: string;
  creditTurnover: string;
  /** Transaction count the document declares, for the self-check. */
  declaredCount: number;
  transactions: ParsedTransaction[];
  /** Problems found by verifying the document against itself. */
  warnings: string[];
}

function toArray(value: unknown): unknown[] {
  if (value === undefined || value === null) {
    return [];
  }

  return Array.isArray(value) ? value : [value];
}

/**
 * Counterparty. Transfers name a person or company in `trn-message`; card
 * payments put the merchant there and a payment-method label in
 * `other-account-number`.
 */
function resolveMerchant(messages: unknown, otherAccount: string | undefined): string | null {
  for (const group of toArray(messages)) {
    if (typeof group !== 'object' || group === null) {
      continue;
    }

    for (const message of toArray((group as Record<string, unknown>)['trn-message'])) {
      const text =
        typeof message === 'string'
          ? message
          : typeof message === 'object' && message !== null
            ? String((message as Record<string, unknown>)['#text'] ?? '')
            : '';

      if (text.trim()) {
        return text.trim();
      }
    }
  }

  const fallback = otherAccount?.trim();

  return fallback ? fallback : null;
}

function sumAmounts(values: readonly string[]): { debit: string; credit: string; net: string } {
  // String maths in minor units: a statement must reconcile to the haler, and
  // summing 84 floats does not.
  let debit = 0n;
  let credit = 0n;

  for (const value of values) {
    const minor = toMinorUnits(value);

    if (minor < 0n) {
      debit -= minor;
    } else {
      credit += minor;
    }
  }

  return { debit: fromMinorUnits(debit), credit: fromMinorUnits(credit), net: fromMinorUnits(credit - debit) };
}

function toMinorUnits(value: string): bigint {
  const match = /^(-)?(\d*)(?:\.(\d+))?$/.exec(value.trim());

  if (!match) {
    throw new CsvStructureError(`Cannot read amount: ${value}`);
  }

  const [, sign, whole = '0', fraction = ''] = match;

  if (fraction.length > 2) {
    throw new CsvStructureError(`Amount has more than 2 decimal places: ${value}`);
  }

  const cents = `${fraction}00`.slice(0, 2);
  const digits = BigInt(`${whole || '0'}${cents}`);

  return sign === '-' ? -digits : digits;
}

function fromMinorUnits(value: bigint): string {
  const negative = value < 0n;
  const absolute = negative ? -value : value;
  const whole = absolute / 100n;
  const cents = absolute % 100n;

  return `${negative ? '-' : ''}${whole}.${cents.toString().padStart(2, '0')}`;
}

export function parseMonetaStatement(xml: string): StatementParseResult {
  const parsedXml: unknown = parser.parse(xml);
  const parsed = statementSchema.safeParse(parsedXml);

  if (!parsed.success) {
    throw new CsvStructureError(
      `Unexpected Moneta statement format: ${parsed.error.issues.map((issue) => issue.path.join('.')).join(', ')}`,
    );
  }

  const { header, transactions: transactionsNode } = parsed.data.statement;
  const account = header.account;

  const transactions: ParsedTransaction[] = [];
  const warnings: string[] = [];

  for (const raw of toArray(transactionsNode?.transaction)) {
    const row = transactionSchema.safeParse(raw);

    if (!row.success) {
      warnings.push(`Nečitelná transakce: ${row.error.issues.map((issue) => issue.path.join('.')).join(', ')}`);
      continue;
    }

    const data = row.data;
    const otherAccount = data['@other-account-number'];
    // Card payments put a payment-method label here, not an account number.
    const counterAccount = otherAccount && /\d/.test(otherAccount) ? otherAccount : null;

    transactions.push({
      externalId: normalizeSourceReference(data['@id']),
      date: new Date(`${data['@date-eff']}T00:00:00.000Z`),
      amount: data['@amount'],
      currency: account['@currency'].toUpperCase(),
      merchant: resolveMerchant(data['trn-messages'], otherAccount),
      description: otherAccount?.trim() || null,
      // The statement has no category column; the CSV export does.
      sourceCategory: null,
      counterAccount,
      raw: Object.fromEntries(
        Object.entries(data).filter(([, value]) => typeof value === 'string') as [string, string][],
      ),
    });
  }

  // Moneta reuses one @id for a same-day interest+tax pair (verified against
  // a real savings statement: "KREDITNÍ ÚROKY" +109.24 and "Daň z úroku"
  // -16.39 both carry id "260831GTA900001"). Trusting it as EXTERNAL_ID would
  // hash both rows to the identical idempotency key and silently drop one as
  // a same-file duplicate — exactly the kind of collision CLAUDE.md's
  // idempotency rule warns about, just from the reference itself this time
  // instead of the attribute fallback. Any id shared by more than one row in
  // this document is not trustworthy as unique, so those specific rows fall
  // back to the ATTRIBUTES strategy instead — date/amount/merchant already
  // tell interest and tax apart, so nothing is lost.
  const idCounts = new Map<string, number>();

  for (const transaction of transactions) {
    if (transaction.externalId) {
      idCounts.set(transaction.externalId, (idCounts.get(transaction.externalId) ?? 0) + 1);
    }
  }

  // Not pushed onto `warnings`: that array also gates whether the closing
  // balance is trusted as a checkpoint anchor (see below), and this
  // collision is routine on a savings account (interest posts monthly) —
  // it would otherwise block auto-anchoring from savings statements every
  // month even though the statement itself reconciles perfectly.
  for (const transaction of transactions) {
    if (transaction.externalId && (idCounts.get(transaction.externalId) ?? 0) > 1) {
      transaction.externalId = null;
    }
  }

  const declaredCount = Number(header.stmt['@trn-cnt']);

  // The document states its own totals, so it can be checked against itself.
  // A mismatch means the parser is wrong or the file is truncated, and either
  // way the balance anchor derived from it must not be trusted silently.
  if (Number.isFinite(declaredCount) && transactions.length !== declaredCount) {
    warnings.push(`Výpis hlásí ${declaredCount} transakcí, načteno ${transactions.length}`);
  }

  const totals = sumAmounts(transactions.map((item) => item.amount));

  if (totals.debit !== normalizeAmount(account['debit-tov'])) {
    warnings.push(`Součet výdajů ${totals.debit} nesedí na deklarovaných ${account['debit-tov']}`);
  }

  if (totals.credit !== normalizeAmount(account['credit-tov'])) {
    warnings.push(`Součet příjmů ${totals.credit} nesedí na deklarovaných ${account['credit-tov']}`);
  }

  const expectedEnd = fromMinorUnits(toMinorUnits(account['stm-bgn-bal']) + toMinorUnits(totals.net));

  if (expectedEnd !== normalizeAmount(header['stm-bal-end'])) {
    warnings.push(
      `Počáteční zůstatek a pohyby dávají ${expectedEnd}, výpis uvádí konečný ${header['stm-bal-end']}`,
    );
  }

  return {
    provider: 'MONETA',
    sourceAccountId: account['@number'],
    currency: account['@currency'].toUpperCase(),
    period: {
      number: header.stmt['@number'],
      from: header.stmt['@date-previous'] || null,
      to: header.stmt['@date'],
    },
    openingBalance: normalizeAmount(account['stm-bgn-bal']),
    closingBalance: normalizeAmount(header['stm-bal-end']),
    debitTurnover: normalizeAmount(account['debit-tov']),
    creditTurnover: normalizeAmount(account['credit-tov']),
    declaredCount,
    transactions,
    warnings,
  };
}

/** Canonical two-decimal form, so declared and computed totals compare as strings. */
function normalizeAmount(value: string): string {
  return fromMinorUnits(toMinorUnits(value));
}
