import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Shared by the daily digest and the big-move checks: for each active T212
 * account, the latest AccountSnapshot and the one closest to ~24h before it
 * (snapshots are written hourly by the sync cron, so "closest to 24h ago" is
 * always available once the account has more than a day of history).
 */

export interface AccountDailyChange {
  accountId: string;
  accountName: string;
  currency: string;
  latestBalance: Prisma.Decimal;
  previousBalance: Prisma.Decimal | null;
  change: Prisma.Decimal | null;
  changePercent: Prisma.Decimal | null;
}

export async function loadInvestmentAccountDailyChanges(now: Date): Promise<AccountDailyChange[]> {
  const accounts = await prisma.account.findMany({
    where: { type: 'INVESTMENT', isArchived: false },
    select: { id: true, name: true },
  });

  const results: AccountDailyChange[] = [];
  const dayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  for (const account of accounts) {
    const latest = await prisma.accountSnapshot.findFirst({
      where: { accountId: account.id },
      orderBy: { capturedAt: 'desc' },
      select: { balance: true, currency: true, unrealizedPnl: true },
    });
    if (!latest) continue;

    const previous = await prisma.accountSnapshot.findFirst({
      where: { accountId: account.id, capturedAt: { lte: dayAgo } },
      orderBy: { capturedAt: 'desc' },
      select: { balance: true, unrealizedPnl: true },
    });

    // Balance moves with deposits; unrealized P/L only with the market. Use it when both snapshots have it.
    const change = previous
      ? latest.unrealizedPnl && previous.unrealizedPnl
        ? latest.unrealizedPnl.minus(previous.unrealizedPnl)
        : latest.balance.minus(previous.balance)
      : null;
    const changePercent = previous && !previous.balance.isZero() ? change?.dividedBy(previous.balance).times(100) ?? null : null;

    results.push({
      accountId: account.id,
      accountName: account.name,
      currency: latest.currency,
      latestBalance: latest.balance,
      previousBalance: previous?.balance ?? null,
      change,
      changePercent,
    });
  }

  return results;
}
