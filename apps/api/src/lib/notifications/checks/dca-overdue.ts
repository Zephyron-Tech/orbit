import { prisma } from '@orbit-api/lib/db/prisma';
import { findUnmatchedDcaPlans, splitOverdueDcaPlans } from '@orbit-api/lib/finance/dca';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';

import { notifyEligibleUsers } from '../notify';
import { pragueMonthKey } from '../time';

export async function checkDcaOverdue(now: Date): Promise<number> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const { from, to } = monthPeriod(year, month);
  const periodEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayDay = Math.min(now.getUTCDate(), periodEndDay);

  const [plans, transactions] = await Promise.all([
    prisma.recurringInvestmentPlan.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: now } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: from } }] }] },
      select: { id: true, name: true, sourceAccountId: true, brokerAccountId: true, expectedAmount: true, currency: true, dueDay: true, graceDays: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: from, lt: to } },
      select: { transferId: true, transfer: { select: { legs: { select: { accountId: true, amount: true, currency: true, kind: true } } } } },
    }),
  ]);

  const unmatched = findUnmatchedDcaPlans(plans, transactions);
  const { overdue } = splitOverdueDcaPlans(unmatched, todayDay, periodEndDay);
  const monthKey = pragueMonthKey(now);

  let sent = 0;
  for (const plan of overdue) {
    const dedupeKey = `${plan.id}:${monthKey}`;
    sent += await notifyEligibleUsers(NotificationType.DCA_OVERDUE, dedupeKey, {
      title: 'DCA plán po termínu',
      body: `${plan.name} — očekávaný vklad ${plan.expectedAmount.toFixed(0)} ${plan.currency} zatím nemá spárovaný převod.`,
      data: { type: 'dca-overdue', planId: plan.id },
    });
  }
  return sent;
}
