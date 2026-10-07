import { prisma } from '@orbit-api/lib/db/prisma';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';

/**
 * The most recently *completed* calendar month, in UTC. Reported as soon as
 * we're into the following month — the hourly cron's own dedupe (keyed to
 * this month, not "now") makes the exact hour it first runs irrelevant.
 */
function previousCompletedMonth(now: Date): { year: number; month: number } {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  return month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
}

function monthKeyOf(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, '0')}`;
}

interface SavingsAccountGrowth {
  accountId: string;
  name: string;
  growth: number;
  /** User's own projected net interest for the month, from annualInterestRate/interestTaxRate — null when no rate is set. */
  expectedMonthly: number | null;
}

/**
 * Growth of each SAVINGS account during the most recently completed month —
 * balance at that month's end minus balance at the previous month's end.
 * Both ends are read via `loadNetWorth`'s own point-in-time `asOf`, so this
 * reuses the exact same transaction-sum-since-checkpoint logic every other
 * balance figure in the app already relies on, not a second calculation.
 */
async function loadSavingsGrowth(now: Date): Promise<SavingsAccountGrowth[]> {
  const { year, month } = previousCompletedMonth(now);
  const period = monthPeriod(year, month);

  const [endOfMonth, startOfMonth, accounts] = await Promise.all([
    loadNetWorth(new Date(period.to.getTime() - 1)),
    loadNetWorth(new Date(period.from.getTime() - 1)),
    prisma.account.findMany({
      where: { type: 'SAVINGS', isArchived: false },
      select: { id: true, annualInterestRate: true, interestTaxRate: true },
    }),
  ]);

  const endBalanceByAccount = new Map(endOfMonth.accounts.map((entry) => [entry.accountId, entry]));
  const startBalanceByAccount = new Map(startOfMonth.accounts.map((entry) => [entry.accountId, entry.balance]));

  return accounts.flatMap((account) => {
    const end = endBalanceByAccount.get(account.id);
    const start = startBalanceByAccount.get(account.id);
    if (!end || !start) return [];

    const growth = end.balance.minus(start).toNumber();
    const expectedMonthly = account.annualInterestRate
      ? start.toNumber() * Number(account.annualInterestRate) * (1 - Number(account.interestTaxRate ?? '0.15')) / 12
      : null;

    return [{ accountId: account.id, name: end.name, growth, expectedMonthly }];
  });
}

export async function checkSavingsGrowth(now: Date): Promise<number> {
  const { year, month } = previousCompletedMonth(now);
  const monthKey = monthKeyOf(year, month);
  const growthByAccount = await loadSavingsGrowth(now);

  let sent = 0;
  for (const account of growthByAccount) {
    const dedupeKey = `${account.accountId}:${monthKey}`;
    const sign = account.growth >= 0 ? '+' : '';
    sent += await notifyEligibleUsers(NotificationType.SAVINGS_GROWTH, dedupeKey, {
      title: 'Měsíční přírůstek spořáku',
      body: `${account.name}: ${sign}${account.growth.toFixed(0)} Kč za minulý měsíc (vklady + úrok).`,
      data: { type: 'savings-growth', accountId: account.accountId },
    });
  }
  return sent;
}

/**
 * A real stagnation signal: growth that doesn't even reach the account's own
 * projected net interest means no real deposit happened that month (or a
 * withdrawal did) — the household's own "did I actually save this month"
 * question, answered automatically. Only accounts with a set rate can be
 * judged this way; a 0% or unset rate has nothing to fall short of.
 */
export async function checkSavingsStagnant(now: Date): Promise<number> {
  const { year, month } = previousCompletedMonth(now);
  const monthKey = monthKeyOf(year, month);
  const growthByAccount = await loadSavingsGrowth(now);

  let sent = 0;
  for (const account of growthByAccount) {
    if (account.expectedMonthly === null || account.expectedMonthly <= 0) continue;
    if (account.growth >= account.expectedMonthly) continue;

    const dedupeKey = `${account.accountId}:${monthKey}`;
    sent += await notifyEligibleUsers(NotificationType.SAVINGS_STAGNANT, dedupeKey, {
      title: 'Spořák minulý měsíc nerostl jak měl',
      body: `${account.name}: přírůstek ${account.growth.toFixed(0)} Kč, čekaný úrok sám o sobě ${account.expectedMonthly.toFixed(0)} Kč.`,
      data: { type: 'savings-stagnant', accountId: account.accountId },
    });
  }
  return sent;
}
