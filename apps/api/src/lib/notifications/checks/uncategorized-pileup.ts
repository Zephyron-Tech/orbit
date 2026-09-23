import { prisma } from '@orbit-api/lib/db/prisma';
import { monthPeriod } from '@orbit-api/lib/finance/settlement';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueIsoWeekKey } from '../time';

const THRESHOLD = 15;
const MONDAY = 'Mon';
const WEEKDAY_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Europe/Prague', weekday: 'short' });

/** Self-gated: only checks on Mondays, to avoid re-computing daily when the weekly dedupe key would suppress the send anyway. */
export async function checkUncategorizedPileup(now: Date): Promise<number> {
  if (WEEKDAY_FORMAT.format(now) !== MONDAY) return 0;

  const { from, to } = monthPeriod(now.getUTCFullYear(), now.getUTCMonth() + 1);
  const count = await prisma.transaction.count({
    where: { date: { gte: from, lt: to }, kind: 'NORMAL', amount: { lt: 0 }, categoryId: null },
  });

  if (count < THRESHOLD) return 0;

  const dedupeKey = pragueIsoWeekKey(now);
  return notifyEligibleUsers(NotificationType.UNCATEGORIZED_PILEUP, dedupeKey, {
    title: 'Nezařazené výdaje se hromadí',
    body: `${count} výdajů tento měsíc bez kategorie.`,
    data: { type: 'uncategorized-pileup', count },
  });
}
