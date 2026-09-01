import type { Prisma } from '@/lib/generated/prisma/client';

/**
 * One computation of "how much can I trust this number", shared by
 * /dashboard's "Mezery v podkladech" tile and /net-worth's "Důvěra v data"
 * panel. Before this, each page wrote its own sum and they silently
 * disagreed: dashboard counted a checkpoint/expected-balance mismatch that
 * net-worth never showed at all, net-worth counted unmatched transfers that
 * dashboard never showed at all, and even the account incomplete/unknown
 * signal was aggregated differently (a union on one page, two separate sums
 * on the other). Same inputs, same function, called from both pages, so the
 * two numbers can't diverge again.
 *
 * Pure: no Prisma, no fetch, no clock — every date/decimal comparison is
 * pre-computed by the caller and handed in.
 */

export interface AccountConfidence {
  accountId: string;
  name: string;
  incompleteHistory: boolean;
  source: string;
}

/** An account counts once even if it trips both flags — one problem, not two. */
export function countIncompleteOrUnknown(accounts: readonly AccountConfidence[]): AccountConfidence[] {
  return accounts.filter((account) => account.incompleteHistory || account.source === 'UNKNOWN');
}

export interface CheckpointAccount {
  accountId: string;
  name: string;
  latestSnapshot: { balance: Prisma.Decimal; expectedBalance: Prisma.Decimal | null } | null;
}

/** An account with no checkpoint at all, or one whose checkpoint doesn't reconcile against the ledger's own prediction. */
export function findCheckpointIssues(accounts: readonly CheckpointAccount[]): CheckpointAccount[] {
  return accounts.filter(({ latestSnapshot }) => {
    if (!latestSnapshot) return true;
    return latestSnapshot.expectedBalance !== null && !latestSnapshot.balance.equals(latestSnapshot.expectedBalance);
  });
}

/**
 * A Trading 212 transfer older than the tracked bank history can never find
 * its matching leg (see hideHistoricalBrokerTransfers/planning) — excluded
 * from the actionable count the same way on both pages. Every other
 * unmatched transfer (any provider, or T212 within the tracked window)
 * counts. A predicate rather than an array transform, so callers can
 * `.filter()` their own richer row shape (with amount/merchant/account name
 * for display) without losing fields to a generic mapped type.
 */
export function isActionableTransfer(transfer: { date: Date; provider: string }, transferHistoryFrom: Date | null): boolean {
  return transfer.provider !== 'TRADING212' || transferHistoryFrom === null || transfer.date.getTime() >= transferHistoryFrom.getTime();
}

export interface DataConfidenceCounts {
  incompleteOrUnknown: number;
  coverageGaps: number;
  actionableTransfers: number;
  checkpointIssues: number;
}

export function totalDataConfidenceIssues(counts: DataConfidenceCounts): number {
  return counts.incompleteOrUnknown + counts.coverageGaps + counts.actionableTransfers + counts.checkpointIssues;
}
