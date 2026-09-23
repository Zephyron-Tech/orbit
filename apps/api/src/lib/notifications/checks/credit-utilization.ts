import { prisma } from '@orbit-api/lib/db/prisma';
import { perAccountUtilization } from '@orbit-api/lib/finance/credit';
import { loadNetWorth } from '@orbit-api/lib/finance/net-worth-service';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueDateKey } from '../time';

const THRESHOLD_PERCENT = 80;

export async function checkCreditUtilizationHigh(now: Date): Promise<number> {
  const [accounts, netWorth] = await Promise.all([
    prisma.account.findMany({
      where: { type: 'CREDIT', isArchived: false, currency: 'CZK', creditLimit: { not: null } },
      select: { id: true, name: true, creditLimit: true },
    }),
    loadNetWorth(now),
  ]);

  const balanceByAccount = new Map(netWorth.accounts.map((a) => [a.accountId, a.balance]));
  const inputs = accounts.flatMap((account) => {
    const balance = balanceByAccount.get(account.id);
    return account.creditLimit && balance ? [{ accountId: account.id, name: account.name, creditLimit: account.creditLimit, balance }] : [];
  });

  const utilizations = perAccountUtilization(inputs);
  const dateKey = pragueDateKey(now);

  let sent = 0;
  for (const utilization of utilizations) {
    if (utilization.utilization.lessThan(THRESHOLD_PERCENT)) continue;

    const dedupeKey = `${utilization.accountId}:${dateKey}`;
    sent += await notifyEligibleUsers(NotificationType.CREDIT_UTILIZATION_HIGH, dedupeKey, {
      title: 'Vysoké čerpání kreditky',
      body: `${utilization.name} — ${utilization.utilization.toFixed(0)} % limitu (${utilization.used.toFixed(0)} z ${utilization.limit.toFixed(0)} Kč).`,
      data: { type: 'credit-utilization-high', accountId: utilization.accountId },
    });
  }
  return sent;
}
