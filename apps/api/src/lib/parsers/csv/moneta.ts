import { parse } from 'csv-parse/sync';

import { normalizeAccountNumber } from '@orbit-api/lib/import/internal-transfers';

import { normalizeSourceReference } from '../reference';

import { parseCzechDate } from './dates';
import { parseCzechAmount } from './numbers';
import { CsvStructureError, type CsvParseResult, type ParseFailure, type ParsedTransaction } from './types';

/**
 * Columns of the Moneta Money Bank CSV export, semicolon separated and quoted.
 * The header is matched exactly: a renamed column must fail loudly rather than
 * silently produce transactions with missing fields.
 */
const COLUMNS = {
  account: 'Číslo účtu',
  iban: 'IBAN',
  counterAccount: 'Číslo protiúčtu',
  counterBank: 'Banka protiúčtu',
  counterName: 'Název účtu příjemce',
  dueDate: 'Splatnost',
  sentDate: 'Odesláno',
  amount: 'Částka',
  currency: 'Měna',
  variableSymbol: 'Variabilní Symbol',
  specificSymbol: 'Specifický Symbol',
  constantSymbol: 'Konstantní Symbol',
  message: 'Zpráva pro příjemce',
  note: 'Poznámka pro mě',
  category: 'Název kategorie',
  type: 'Typ transakce',
  standingOrder: 'Název trvalého příkazu',
  description: 'Popis platby',
  description2: 'Popis platby 2',
  description3: 'Popis platby 3',
  reference: 'Bankovní reference',
  card: 'Číslo karty',
  method: 'Platební metoda',
} as const;

const REQUIRED_COLUMNS: readonly string[] = [
  COLUMNS.account,
  COLUMNS.sentDate,
  COLUMNS.amount,
  COLUMNS.currency,
  COLUMNS.reference,
];

const CREDIT_REQUIRED_COLUMNS: readonly string[] = [
  COLUMNS.card,
  COLUMNS.sentDate,
  COLUMNS.amount,
  COLUMNS.currency,
  COLUMNS.reference,
];

/**
 * Reads a cell and collapses whitespace-only values to an empty string.
 *
 * Moneta writes a single space into `Popis platby` on direct debits. Because
 * `" "` is truthy, a naive `a || b` fallback would pick the space and discard
 * the real counterparty name.
 */
function cell(row: Record<string, string>, column: string): string {
  return (row[column] ?? '').trim();
}

/** First non-empty candidate, or null. */
function firstOf(...candidates: string[]): string | null {
  for (const candidate of candidates) {
    if (candidate.length > 0) {
      return candidate;
    }
  }

  return null;
}

/**
 * `Popis platby` is the merchant on card payments but boilerplate on transfers
 * and standing orders, where it repeats the instrument instead of naming anyone.
 * Those values are skipped when resolving a counterparty; they are still kept
 * as the description.
 */
const GENERIC_DESCRIPTIONS: readonly string[] = ['OKAMŽITÁ ÚHRADA', 'PŘEVOD', 'PLATBA'];
const GENERIC_DESCRIPTION_PREFIXES: readonly string[] = ['TRVALÝ PŘÍK'];

function isGenericDescription(value: string): boolean {
  const upper = value.toUpperCase();

  return (
    GENERIC_DESCRIPTIONS.includes(upper) ||
    GENERIC_DESCRIPTION_PREFIXES.some((prefix) => upper.startsWith(prefix))
  );
}

/**
 * Resolves the counterparty. `Název účtu příjemce` is the bank's own name for
 * the other side and wins whenever it is filled in; card payments leave it
 * empty and carry the merchant in `Popis platby` instead.
 */
function resolveMerchant(row: Record<string, string>): string | null {
  const counterAccount = cell(row, COLUMNS.counterAccount);
  const counterBank = cell(row, COLUMNS.counterBank);
  const accountFallback = counterAccount && counterBank ? `${counterAccount}/${counterBank}` : counterAccount;

  const description = cell(row, COLUMNS.description);

  return firstOf(
    cell(row, COLUMNS.counterName),
    cell(row, COLUMNS.standingOrder),
    isGenericDescription(description) ? '' : description,
    cell(row, COLUMNS.message),
    accountFallback,
  );
}

export function resolveDescription(row: Record<string, string>): string | null {
  return firstOf(
    cell(row, COLUMNS.standingOrder),
    cell(row, COLUMNS.note),
    cell(row, COLUMNS.message),
    cell(row, COLUMNS.type),
  );
}

export function parseMonetaCsv(text: string): CsvParseResult {
  const rows = parse(text, {
    delimiter: ';',
    columns: true,
    skip_empty_lines: true,
    trim: false,
    bom: true,
    relax_column_count: false,
  }) as Record<string, string>[];

  const header = rows[0];

  if (!header) {
    throw new CsvStructureError('The CSV export contains no data rows');
  }

  const isCreditExport = COLUMNS.card in header && !(COLUMNS.account in header);
  const required = isCreditExport ? CREDIT_REQUIRED_COLUMNS : REQUIRED_COLUMNS;
  const missing = required.filter((column) => !(column in header));

  if (missing.length > 0) {
    throw new CsvStructureError(`Unexpected Moneta export format, missing columns: ${missing.join(', ')}`);
  }

  const transactions: ParsedTransaction[] = [];
  const failures: ParseFailure[] = [];
  // Keyed by normalizeAccountNumber, not the raw cell: Moneta writes some rows
  // (Apple Pay / T212 card-top-up settlement rows, seen in a real export) with
  // the bank code stripped ("204370628" instead of "204370628/0600") even
  // though every other row in the same file carries it — same account, just a
  // different rendering, and normalizing avoids a false "mixes several
  // accounts" refusal.
  const accountIds = new Set<string>();
  let sourceAccountId: string | null = null;
  const cardLast4 = new Set<string>();

  rows.forEach((row, index) => {
    // +2: the header is line 1 and the index is zero-based.
    const rowNumber = index + 2;

    try {
      const reference = cell(row, COLUMNS.reference);

      if (!reference) {
        // Without the bank's own reference two identical purchases on the same
        // day are indistinguishable, and one would be dropped as a duplicate.
        throw new Error('Missing "Bankovní reference", cannot deduplicate this row safely');
      }

      const account = cell(row, COLUMNS.account);

      if (account) {
        accountIds.add(normalizeAccountNumber(account));
        sourceAccountId ??= account;
      }
      if (isCreditExport) {
        const card = cell(row, COLUMNS.card);

        // Package-benefit rewards ("ODMĚNA BALÍČKU VÝHOD", seen in a real
        // export) post to the account itself, not to a specific card, and
        // leave this cell empty — that's not a malformed row, only a row
        // this file's card binding doesn't apply to.
        if (card) {
          const last4 = /(?:\D|^)(\d{4})$/.exec(card)?.[1] ?? null;
          if (!last4) {
            throw new Error('Missing usable last four digits in "Číslo karty"');
          }
          cardLast4.add(last4);
        }
      }

      transactions.push({
        // Canonical form, so a statement import recognises the same row.
        externalId: normalizeSourceReference(reference),
        date: parseCzechDate(cell(row, COLUMNS.sentDate)),
        amount: parseCzechAmount(cell(row, COLUMNS.amount)),
        currency: cell(row, COLUMNS.currency).toUpperCase() || 'CZK',
        merchant: resolveMerchant(row),
        description: resolveDescription(row),
        counterAccount: cell(row, COLUMNS.counterAccount) || null,
        sourceCategory: cell(row, COLUMNS.category) || null,
        raw: row,
      });
    } catch (error: unknown) {
      failures.push({
        rowNumber,
        reason: error instanceof Error ? error.message : 'Unknown parsing error',
        raw: row,
      });
    }
  });

  if (accountIds.size > 1) {
    throw new CsvStructureError(
      `The export mixes several accounts (${[...accountIds].join(', ')}); import them one at a time`,
    );
  }
  if (cardLast4.size > 1) {
    throw new CsvStructureError(`The export mixes several cards (${[...cardLast4].join(', ')}); import them one at a time`);
  }

  return {
    provider: 'MONETA',
    sourceAccountId,
    sourceCardLast4: [...cardLast4][0] ?? null,
    transactions,
    failures,
  };
}
