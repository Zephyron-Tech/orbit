import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { buildAccountBalanceHistory, type AccountBalanceHistoryPoint } from './account-balance-history';
import { loadNetWorth } from './net-worth-service';

/**
 * Narrows `NetWorthSnapshot.breakdown` (stored as untyped `Json`) to the two
 * fields this file reads. The shape is written by `recordNetWorthSnapshot` —
 * trusted, not external input — but `any`/unchecked casts are still banned,
 * so a malformed or future-shaped row is skipped rather than crashing the
 * whole history read.
 */
const breakdownEntrySchema = z.object({ accountId: z.string(), balance: z.string().optional() });
const breakdownSchema = z.array(breakdownEntrySchema).catch([]);

/** Database-facing wrapper around the pure aggregation in `account-balance-history.ts`. */
export async function loadAccountBalanceHistory(accountId: string, months = 12): Promise<AccountBalanceHistoryPoint[]> {
  const since = new Date();
  since.setUTCMonth(since.getUTCMonth() - months);
  since.setUTCHours(0, 0, 0, 0);

  const [snapshots, interestTransactions, netWorth] = await Promise.all([
    prisma.netWorthSnapshot.findMany({
      where: { date: { gte: since } },
      orderBy: { date: 'asc' },
      select: { date: true, breakdown: true },
    }),
    prisma.transaction.findMany({
      where: { accountId, category: { key: 'interest' } },
      select: { date: true, amount: true, currency: true, amountCzk: true },
      orderBy: { date: 'asc' },
    }),
    loadNetWorth(),
  ]);

  const snapshotEntries = snapshots.flatMap((row) => {
    const breakdown = breakdownSchema.parse(row.breakdown);
    const entry = breakdown.find((candidate) => candidate.accountId === accountId);
    return entry?.balance ? [{ date: row.date, balance: entry.balance }] : [];
  });

  const interestRows = interestTransactions.map((transaction) => ({
    date: transaction.date,
    amountCzk: transaction.currency === 'CZK' ? transaction.amount : (transaction.amountCzk ?? new Prisma.Decimal(0)),
  }));

  const liveBalance = netWorth.accounts.find((entry) => entry.accountId === accountId)?.balance ?? new Prisma.Decimal(0);

  return buildAccountBalanceHistory(snapshotEntries, interestRows, { date: new Date(), balanceCzk: liveBalance });
}
