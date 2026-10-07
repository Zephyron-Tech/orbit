import { prisma } from '@orbit-api/lib/db/prisma';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';

/**
 * Fires once per account per goal amount — the dedupe key includes the goal
 * itself, so raising the target after it's been reached makes the user
 * eligible to be notified again when the new, higher goal is reached too.
 */
export async function checkSavingsGoalReached(now: Date): Promise<number> {
  const [accounts, netWorth] = await Promise.all([
    prisma.account.findMany({
      where: { type: 'SAVINGS', isArchived: false, savingsGoalAmount: { not: null } },
      select: { id: true, name: true, savingsGoalAmount: true },
    }),
    loadNetWorth(now),
  ]);

  const balanceByAccount = new Map(netWorth.accounts.map((entry) => [entry.accountId, entry.balance]));

  let sent = 0;
  for (const account of accounts) {
    const balance = balanceByAccount.get(account.id);
    const goal = account.savingsGoalAmount;
    if (!balance || !goal || balance.lessThan(goal)) continue;

    const dedupeKey = `${account.id}:${goal.toFixed(2)}`;
    sent += await notifyEligibleUsers(NotificationType.SAVINGS_GOAL_REACHED, dedupeKey, {
      title: 'Spořicí cíl dosažen',
      body: `${account.name}: dosáhli jste cíle ${goal.toFixed(0)} Kč.`,
      data: { type: 'savings-goal-reached', accountId: account.id },
    });
  }
  return sent;
}
