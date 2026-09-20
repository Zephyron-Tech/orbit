import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

export interface AccountAnalytics {
  accountId: string;
  averageIncome: string;
  medianIncome: string;
  averageExpense: string;
  medianExpense: string;
  monthToDateIncome: string;
  monthToDateExpense: string;
  refunds: string;
  interestEarned: string;
  months: number;
  fromMonth: string | null;
  toMonth: string | null;
}

function monthKey(date: Date): string {
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
}

function median(values: Prisma.Decimal[]): Prisma.Decimal {
  if (values.length === 0) return new Prisma.Decimal(0);
  const sorted = [...values].sort((a, b) => a.comparedTo(b));
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2) return sorted[mid] ?? new Prisma.Decimal(0);
  return (sorted[mid - 1] ?? new Prisma.Decimal(0)).plus(sorted[mid] ?? new Prisma.Decimal(0)).dividedBy(2);
}

/** Monthly account-native flow statistics; transfers and settlements are excluded. */
export async function loadAccountAnalytics(accountId: string, currency: string): Promise<AccountAnalytics> {
  const now = new Date();
  const currentMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const lookback = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 12, 1));
  const rows = await prisma.transaction.findMany({
    where: { accountId, date: { gte: lookback, lte: now }, kind: 'NORMAL', currency },
    select: { date: true, amount: true, category: { select: { key: true } } },
  });
  const completedRows = rows.filter((row) => row.date < currentMonth);
  const firstObserved = completedRows.reduce<Date | null>((earliest, row) => !earliest || row.date < earliest ? row.date : earliest, null);
  const totals = new Map<string, { income: Prisma.Decimal; expense: Prisma.Decimal }>();
  if (firstObserved) {
    for (let cursor = new Date(Date.UTC(firstObserved.getUTCFullYear(), firstObserved.getUTCMonth(), 1)); cursor < currentMonth; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
      totals.set(monthKey(cursor), { income: new Prisma.Decimal(0), expense: new Prisma.Decimal(0) });
    }
  }
  let mtdIncome = new Prisma.Decimal(0);
  let mtdExpense = new Prisma.Decimal(0);
  let refunds = new Prisma.Decimal(0);
  let interest = new Prisma.Decimal(0);
  for (const row of rows) {
    const isCurrent = row.date >= currentMonth;
    if (row.amount.isPositive()) {
      if (isCurrent && row.category?.key === 'income') mtdIncome = mtdIncome.plus(row.amount);
      if (row.category?.key === 'interest') interest = interest.plus(row.amount);
      if (row.category?.key !== 'income' && row.category?.key !== 'interest') refunds = refunds.plus(row.amount);
    } else {
      if (isCurrent) mtdExpense = mtdExpense.plus(row.amount.abs());
    }
    const month = totals.get(monthKey(row.date));
    if (!month) continue;
    if (row.amount.isPositive() && row.category?.key === 'income') month.income = month.income.plus(row.amount);
    else month.expense = month.expense.plus(row.amount.abs());
  }
  const months = [...totals.values()];
  const incomeValues = months.map((item) => item.income);
  const expenseValues = months.map((item) => item.expense);
  const average = (values: Prisma.Decimal[]) => values.length ? values.reduce((sum, value) => sum.plus(value), new Prisma.Decimal(0)).dividedBy(values.length) : new Prisma.Decimal(0);
  return {
    accountId,
    averageIncome: average(incomeValues).toFixed(2),
    medianIncome: median(incomeValues).toFixed(2),
    averageExpense: average(expenseValues).toFixed(2),
    medianExpense: median(expenseValues).toFixed(2),
    monthToDateIncome: mtdIncome.toFixed(2),
    monthToDateExpense: mtdExpense.toFixed(2),
    refunds: refunds.toFixed(2),
    interestEarned: interest.toFixed(2),
    months: months.length,
    fromMonth: firstObserved ? monthKey(firstObserved) : null,
    toMonth: months.length > 0 ? monthKey(new Date(currentMonth.getTime() - 1)) : null,
  };
}
