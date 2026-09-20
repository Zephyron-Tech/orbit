import type { Provider } from '@/lib/generated/prisma/enums';

/** A transaction as understood by a parser, before it touches the database. */
export interface ParsedTransaction {
  /** The source's own reference. Present whenever the export supplies one. */
  externalId: string | null;
  /** Booking date at midnight UTC of the calendar day. */
  date: Date;
  /** Signed decimal string: negative for expenses. Never a JS number. */
  amount: string;
  currency: string;
  merchant: string | null;
  description: string | null;
  /**
   * Counterparty account number as printed by the source, when there is one.
   * Used to recognise a transfer between two accounts that are both ours.
   */
  counterAccount: string | null;
  /** Category name as supplied by the bank, before mapping to a Category row. */
  sourceCategory: string | null;
  /** The complete source row, stored for replay and debugging. */
  raw: Record<string, string>;
}

/** A row that could not be parsed. Never thrown away: it is logged and shown. */
export interface ParseFailure {
  /** 1-based line number in the file, header included. */
  rowNumber: number;
  reason: string;
  raw: Record<string, string>;
}

export interface CsvParseResult {
  provider: Provider;
  /** Account identifier read from the file itself, when the export contains one. */
  sourceAccountId: string | null;
  /** Last four digits from a card-history export, used only to bind CREDIT imports. */
  sourceCardLast4: string | null;
  transactions: ParsedTransaction[];
  failures: ParseFailure[];
}

/**
 * A parser turns decoded file text into transactions. It is pure: no database,
 * no network, no clock. Structural problems (a missing column, an unreadable
 * header) throw; a single bad row becomes a `ParseFailure`.
 */
export type CsvParser = (text: string) => CsvParseResult;

export class CsvStructureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CsvStructureError';
  }
}
