import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Matches an uploaded Orlen receipt to the `FuelPurchase` row it belongs to.
 * Pure: candidates in, a verdict out. No Prisma.
 *
 * The `Sales.xls` export has no receipt reference to join on, so this is a
 * fuzzy match — station + exact final amount + purchase time within a short
 * window. When more than one candidate satisfies that, none of them is
 * matched: guessing wrong here would silently attach the wrong discount to
 * the wrong purchase, worse than leaving it for manual review. Same
 * ambiguity rule `lib/finance/transfer-matching.ts` already uses for bank
 * transfers.
 */

export interface FuelPurchaseCandidate {
  id: string;
  stationCode: string;
  purchasedAt: Date;
  amountCzk: Prisma.Decimal;
}

export interface FuelReceiptToMatch {
  stationCode: string;
  purchasedAt: Date;
  totalAfterDiscount: Prisma.Decimal;
}

const DEFAULT_WINDOW_MINUTES = 5;
const MINUTE_MS = 60_000;

/** Returns the matched purchase id, or `null` when there is no candidate or more than one. */
export function matchReceiptToPurchase(
  receipt: FuelReceiptToMatch,
  candidates: readonly FuelPurchaseCandidate[],
  windowMinutes = DEFAULT_WINDOW_MINUTES,
): string | null {
  const windowMs = windowMinutes * MINUTE_MS;

  const matches = candidates.filter(
    (candidate) =>
      candidate.stationCode === receipt.stationCode &&
      candidate.amountCzk.equals(receipt.totalAfterDiscount) &&
      Math.abs(candidate.purchasedAt.getTime() - receipt.purchasedAt.getTime()) <= windowMs,
  );

  return matches.length === 1 ? (matches[0]?.id ?? null) : null;
}
