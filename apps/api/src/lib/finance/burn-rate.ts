import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { TransactionKind } from '@orbit-api/lib/generated/prisma/enums';

import { computeMyShare } from './share';

/**
 * The cost of running the household independent of variable spending: the sum
 * of transactions tagged to a `RecurringExpense`, for one month. Pure —
 * inputs in, numbers out — mirroring `settlement.ts`, and reusing the same
 * `computeMyShare` so "my share" means the same thing in both places.
 */

const ZERO = new Prisma.Decimal(0);

export interface BurnRateTransaction {
  recurringExpenseId: string | null;
  /** Signed amount in the reporting currency. */
  amountCzk: Prisma.Decimal;
  date: Date;
  kind: TransactionKind;
  isShared: boolean;
  myShareRatio: Prisma.Decimal | null;
}

export interface RecurringExpenseInput {
  id: string;
  name: string;
  isActive: boolean;
}

export interface BurnRateLine {
  recurringExpenseId: string;
  name: string;
  /** Sum of the actual transactions tagged this month, absolute value. */
  actual: Prisma.Decimal;
  /** My share of `actual`, using each transaction's own sharing settings. */
  myShare: Prisma.Decimal;
  transactionCount: number;
}

export interface BurnRateResult {
  total: Prisma.Decimal;
  myShare: Prisma.Decimal;
  lines: BurnRateLine[];
  /** Active recurring expenses with no tagged transaction in this month. */
  missing: { recurringExpenseId: string; name: string }[];
}

/**
 * Only real spending counts: the same exclusions as `settlement.ts` apply
 * here, because a transfer, a settlement repayment, or a split parent is not
 * a cost, regardless of whether someone tagged it.
 */
function isRealExpense(transaction: BurnRateTransaction): boolean {
  return (
    transaction.kind === 'NORMAL' && transaction.recurringExpenseId !== null && transaction.amountCzk.isNegative()
  );
}

export function calculateBurnRate(
  transactions: readonly BurnRateTransaction[],
  recurringExpenses: readonly RecurringExpenseInput[],
): BurnRateResult {
  const byExpense = new Map<string, { actual: Prisma.Decimal; myShare: Prisma.Decimal; count: number }>();

  for (const transaction of transactions) {
    if (!isRealExpense(transaction) || transaction.recurringExpenseId === null) {
      continue;
    }

    const amount = transaction.amountCzk.abs();
    // Not every recurring cost is shared — e.g. a personal subscription — so
    // an unshared line's "my share" is the whole amount, same as settlement's
    // treatment of an unshared transaction.
    const myShare = transaction.isShared
      ? computeMyShare(amount, transaction.myShareRatio, `Transaction tagged to recurring expense`)
      : amount;

    const current = byExpense.get(transaction.recurringExpenseId) ?? { actual: ZERO, myShare: ZERO, count: 0 };

    byExpense.set(transaction.recurringExpenseId, {
      actual: current.actual.plus(amount),
      myShare: current.myShare.plus(myShare),
      count: current.count + 1,
    });
  }

  const lines: BurnRateLine[] = [];
  const missing: { recurringExpenseId: string; name: string }[] = [];

  let total = ZERO;
  let myShareTotal = ZERO;

  for (const expense of recurringExpenses) {
    if (!expense.isActive) {
      continue;
    }

    const entry = byExpense.get(expense.id);

    if (!entry) {
      missing.push({ recurringExpenseId: expense.id, name: expense.name });
      continue;
    }

    lines.push({
      recurringExpenseId: expense.id,
      name: expense.name,
      actual: entry.actual,
      myShare: entry.myShare,
      transactionCount: entry.count,
    });

    total = total.plus(entry.actual);
    myShareTotal = myShareTotal.plus(entry.myShare);
  }

  return { total, myShare: myShareTotal, lines, missing };
}

export interface RecurringDueInput {
  dueDay: number | null;
  graceDays: number;
}

/**
 * Splits a set of "missing this period" recurring expenses into overdue
 * (past dueDay + graceDays) and upcoming (not yet due, or no dueDay set at
 * all). Extracted from apps/api/src/routes/dashboard.ts so the dashboard
 * route and the `overdue-recurring` notification check share one
 * implementation of the due/grace math.
 */
export function splitOverdueRecurring<T extends RecurringDueInput>(missing: readonly T[], todayDay: number, periodEndDay: number): { overdue: T[]; upcoming: T[] } {
  const overdue: T[] = [];
  const upcoming: T[] = [];

  for (const expense of missing) {
    if (expense.dueDay === null) {
      upcoming.push(expense);
      continue;
    }
    const due = Math.min(expense.dueDay, periodEndDay);
    (todayDay > due + expense.graceDays ? overdue : upcoming).push(expense);
  }

  return { overdue, upcoming };
}
