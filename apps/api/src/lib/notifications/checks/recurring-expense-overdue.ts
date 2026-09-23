import { prisma } from '@orbit-api/lib/db/prisma';
import { splitOverdueRecurring } from '@orbit-api/lib/finance/burn-rate';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueMonthKey } from '../time';

export async function checkRecurringExpenseOverdue(now: Date): Promise<number> {
  const year = now.getUTCFullYear();
  const month = now.getUTCMonth() + 1;
  const { from, to } = monthPeriod(year, month);
  const periodEndDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const todayDay = Math.min(now.getUTCDate(), periodEndDay);

  const [expenses, taggedTransactions] = await Promise.all([
    prisma.recurringExpense.findMany({
      where: { isActive: true, AND: [{ OR: [{ startsOn: null }, { startsOn: { lte: now } }] }, { OR: [{ endsOn: null }, { endsOn: { gte: from } }] }] },
      select: { id: true, name: true, expectedAmount: true, currency: true, dueDay: true, graceDays: true },
    }),
    prisma.transaction.findMany({
      where: { date: { gte: from, lt: to }, kind: 'NORMAL', amount: { lt: 0 }, recurringExpenseId: { not: null } },
      select: { recurringExpenseId: true },
    }),
  ]);

  const taggedIds = new Set(taggedTransactions.map((t) => t.recurringExpenseId));
  const missing = expenses.filter((expense) => !taggedIds.has(expense.id));
  const { overdue } = splitOverdueRecurring(missing, todayDay, periodEndDay);
  const monthKey = pragueMonthKey(now);

  let sent = 0;
  for (const expense of overdue) {
    const dedupeKey = `${expense.id}:${monthKey}`;
    sent += await notifyEligibleUsers(NotificationType.RECURRING_EXPENSE_OVERDUE, dedupeKey, {
      title: 'Fixní výdaj po termínu',
      body: `${expense.name} — očekáváno ${expense.expectedAmount.toFixed(0)} ${expense.currency}, zatím nezaplaceno.`,
      data: { type: 'recurring-expense-overdue', recurringExpenseId: expense.id },
    });
  }
  return sent;
}
