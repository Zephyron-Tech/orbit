import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Balance + interest over time for one account. Pure: inputs in, numbers out,
 * no Prisma, no clock — the caller supplies "now" via `livePoint`.
 *
 * Historical points come from `NetWorthSnapshot.breakdown`, written once/day
 * by the cron rollup. That alone can't reflect a deposit made minutes ago, so
 * the caller always appends one live-computed point (`loadNetWorth()`'s own
 * figure for this account) — without it, the chart would lag a day behind a
 * manual change the user just made.
 */

export interface AccountBalanceHistoryPoint {
  /** UTC calendar day, "YYYY-MM-DD". */
  date: string;
  balance: number;
  /** Running total of this account's `category.key === 'interest'` transactions up to this date, all-time. */
  cumulativeInterest: number;
}

export interface AccountBalanceSnapshotEntry {
  date: Date;
  /** CZK balance as stored in the snapshot's breakdown JSON. */
  balance: string;
}

export interface AccountInterestTransaction {
  date: Date;
  amountCzk: Prisma.Decimal;
}

export function buildAccountBalanceHistory(
  snapshotEntries: readonly AccountBalanceSnapshotEntry[],
  interestTransactions: readonly AccountInterestTransaction[],
  livePoint: { date: Date; balanceCzk: Prisma.Decimal },
): AccountBalanceHistoryPoint[] {
  const sortedInterest = [...interestTransactions].sort((a, b) => a.date.getTime() - b.date.getTime());

  function cumulativeInterestAt(asOf: Date): number {
    return sortedInterest
      .filter((transaction) => transaction.date.getTime() <= asOf.getTime())
      .reduce((sum, transaction) => sum.plus(transaction.amountCzk), new Prisma.Decimal(0))
      .toNumber();
  }

  const historical = snapshotEntries.map((entry) => ({
    date: entry.date.toISOString().slice(0, 10),
    balance: Number(entry.balance),
    cumulativeInterest: cumulativeInterestAt(entry.date),
  }));

  return [
    ...historical,
    {
      date: livePoint.date.toISOString().slice(0, 10),
      balance: livePoint.balanceCzk.toNumber(),
      cumulativeInterest: cumulativeInterestAt(livePoint.date),
    },
  ];
}
