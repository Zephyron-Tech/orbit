import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { calculateNetWorth, type NetWorthResult } from './net-worth';

/**
 * Database-facing wrapper around the pure aggregation in `net-worth.ts`.
 * Everything that touches Prisma lives here so the arithmetic stays testable.
 */
export async function loadNetWorth(asOf?: Date): Promise<NetWorthResult> {
  // Ledger may contain future-dated scheduled/imported movements. The current
  // net-worth view must never include them before their calendar day arrives.
  const effectiveAsOf = asOf ?? endOfTodayUtc();
  const transactionWhere = { date: { lte: effectiveAsOf } };
  const snapshotWhere = { capturedAt: { lte: effectiveAsOf } };
  const [accounts, transactions, snapshots] = await Promise.all([
    prisma.account.findMany({
      where: { isArchived: false },
      select: {
        id: true,
        name: true,
        type: true,
        currency: true,
        includeInNetWorth: true,
      },
      orderBy: { name: 'asc' },
    }),
    prisma.transaction.findMany({
      where: transactionWhere,
      select: { accountId: true, date: true, amount: true, amountCzk: true, currency: true, kind: true },
    }),
    prisma.accountSnapshot.findMany({
      where: snapshotWhere,
      select: { accountId: true, capturedAt: true, balanceCzk: true },
      orderBy: { capturedAt: 'asc' },
    }),
  ]);

  return calculateNetWorth(
    accounts,
    transactions.flatMap((transaction) => {
      const amountCzk = transaction.currency === 'CZK' ? transaction.amount : transaction.amountCzk;
      return amountCzk ? [{ accountId: transaction.accountId, date: transaction.date, amountCzk, kind: transaction.kind }] : [];
    }),
    snapshots,
  );
}

function endOfTodayUtc(): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 23, 59, 59, 999));
}

/**
 * Writes today's net worth rollup. Append-only and idempotent: the capture date
 * is truncated to the day, so a re-run updates the existing row rather than
 * creating a second history point for the same day.
 */
export async function recordNetWorthSnapshot(now: Date = new Date()): Promise<{
  date: string;
  totalWorth: string;
  created: boolean;
}> {
  const result = await loadNetWorth();

  const date = new Date(now);
  date.setUTCHours(0, 0, 0, 0);

  const breakdown = result.accounts.map((entry) => ({
    accountId: entry.accountId,
    name: entry.name,
    type: entry.type,
    balance: entry.balance.toFixed(2),
    source: entry.source,
    asOf: entry.asOf?.toISOString() ?? null,
  }));

  const existing = await prisma.netWorthSnapshot.findUnique({ where: { date } });

  const data = {
    totalWorth: result.totalWorth,
    cashValue: result.cashValue,
    investmentValue: result.investmentValue,
      liabilityValue: result.liabilityValue,
    breakdown,
  };

  if (existing) {
    await prisma.netWorthSnapshot.update({ where: { id: existing.id }, data });
  } else {
    await prisma.netWorthSnapshot.create({ data: { date, ...data } });
  }

  return {
    date: date.toISOString().slice(0, 10),
    totalWorth: result.totalWorth.toFixed(2),
    created: existing === null,
  };
}

/** History for the chart, oldest first. */
export async function loadNetWorthHistory(limit = 365): Promise<
  { date: string; totalWorth: number; cashValue: number; investmentValue: number; liabilityValue: number }[]
> {
  const rows = await prisma.netWorthSnapshot.findMany({ orderBy: { date: 'desc' }, take: limit });

  // Recharts needs plain numbers; Decimal is exact in the database and only
  // becomes a float at the very edge, for pixel positions.
  return rows.reverse().map((row) => ({
    date: row.date.toISOString().slice(0, 10),
    totalWorth: toNumber(row.totalWorth),
    cashValue: toNumber(row.cashValue),
    investmentValue: toNumber(row.investmentValue),
    liabilityValue: toNumber(row.liabilityValue),
  }));
}

function toNumber(value: Prisma.Decimal): number {
  return value.toNumber();
}
