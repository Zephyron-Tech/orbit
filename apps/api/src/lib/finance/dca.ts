import type { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * DCA (dollar-cost-averaging) funding-plan matching, extracted from
 * apps/api/src/routes/dashboard.ts so the dashboard route and the
 * `dca-overdue` notification check (lib/notifications/checks/dca-overdue.ts)
 * share one implementation instead of two forks of the same matching logic.
 * Pure — inputs in, plans out, no Prisma.
 */

export interface DcaPlanInput {
  id: string;
  sourceAccountId: string | null;
  brokerAccountId: string;
  expectedAmount: Prisma.Decimal;
  currency: string;
  dueDay: number;
  graceDays: number;
}

interface TransferLeg {
  accountId: string;
  amount: Prisma.Decimal;
  currency: string;
  kind: string;
}

export interface DcaMatchTransaction {
  transferId: string | null;
  transfer: { legs: TransferLeg[] } | null;
}

/**
 * A plan is "matched" for the period when some transaction's transfer has a
 * broker-account leg (positive, INTERNAL_TRANSFER, same currency, exact
 * expected amount) paired with a source-account leg (negative,
 * INTERNAL_TRANSFER) on the other side. Each matched transfer can only
 * satisfy one plan, so a transfer already claimed by an earlier plan in the
 * list can't also satisfy a later one.
 */
export function findUnmatchedDcaPlans<T extends DcaPlanInput>(plans: readonly T[], transactions: readonly DcaMatchTransaction[]): T[] {
  const claimedTransferIds = new Set<string>();

  return plans.filter((plan) => {
    const candidate = transactions.find((transaction) => {
      if (!transaction.transferId || !transaction.transfer || claimedTransferIds.has(transaction.transferId)) return false;
      const legs = transaction.transfer.legs;
      const brokerLeg = legs.find((leg) => leg.accountId === plan.brokerAccountId && leg.amount.isPositive() && leg.kind === 'INTERNAL_TRANSFER');
      const hasSourceLeg = plan.sourceAccountId
        ? legs.some((leg) => leg.accountId === plan.sourceAccountId && leg.amount.isNegative() && leg.kind === 'INTERNAL_TRANSFER')
        : legs.some((leg) => leg.accountId !== plan.brokerAccountId && leg.amount.isNegative() && leg.kind === 'INTERNAL_TRANSFER');
      if (!brokerLeg || !hasSourceLeg || brokerLeg.currency !== plan.currency) return false;
      return brokerLeg.amount.abs().equals(plan.expectedAmount);
    });

    if (candidate?.transferId) {
      claimedTransferIds.add(candidate.transferId);
      return false;
    }

    return true;
  });
}

/** Splits unmatched plans into overdue (past dueDay+graceDays) and pending (not yet due). */
export function splitOverdueDcaPlans<T extends { dueDay: number; graceDays: number }>(
  unmatchedPlans: readonly T[],
  todayDay: number,
  periodEndDay: number,
): { overdue: T[]; pending: T[] } {
  const overdue: T[] = [];
  const pending: T[] = [];

  for (const plan of unmatchedPlans) {
    const due = Math.min(plan.dueDay, periodEndDay);
    (todayDay > due + plan.graceDays ? overdue : pending).push(plan);
  }

  return { overdue, pending };
}
