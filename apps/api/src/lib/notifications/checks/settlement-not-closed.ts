import { prisma } from '@orbit-api/lib/db/prisma';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueDayOfMonth } from '../time';

const GATE_UNTIL_DAY = 5;

/** Self-gated: only checks during the first few days of a new month. */
export async function checkSettlementNotClosed(now: Date): Promise<number> {
  if (pragueDayOfMonth(now) > GATE_UNTIL_DAY) return 0;

  const previousMonthDate = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
  const { from, to } = monthPeriod(previousMonthDate.getUTCFullYear(), previousMonthDate.getUTCMonth() + 1);

  const settlement = await prisma.settlement.findFirst({
    where: { periodFrom: from, periodTo: to },
    select: { settledAt: true },
  });

  if (settlement?.settledAt) return 0;

  const dedupeKey = `${from.toISOString()}:${to.toISOString()}`;
  const label = `${String(from.getUTCMonth() + 1).padStart(2, '0')}/${from.getUTCFullYear()}`;

  return notifyEligibleUsers(NotificationType.SETTLEMENT_NOT_CLOSED, dedupeKey, {
    title: 'Vyrovnání za minulý měsíc čeká',
    body: `Vyrovnání za ${label} ještě není uzavřené.`,
    data: { type: 'settlement-not-closed' },
  });
}
