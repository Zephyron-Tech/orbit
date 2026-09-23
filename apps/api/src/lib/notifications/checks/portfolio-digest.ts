import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { loadInvestmentAccountDailyChanges } from '../portfolio-snapshots';
import { isPragueHourOrLater, isPragueWeekday, pragueDateKey } from '../time';

const DIGEST_HOUR = 19;
const ZERO = new Prisma.Decimal(0);

/**
 * Self-gated: only actually does anything on a weekday at-or-after 19:00
 * Prague time. Not an exact-hour match — the cron loop's drift can skip an
 * hour entirely (see isPragueHourOrLater's doc comment) — the per-day
 * dedupe key (pragueDateKey) is what keeps this to once a day regardless of
 * how many ticks land after the threshold.
 */
export async function checkPortfolioDigest(now: Date): Promise<number> {
  if (!isPragueWeekday(now) || !isPragueHourOrLater(now, DIGEST_HOUR)) return 0;

  const changes = await loadInvestmentAccountDailyChanges(now);
  if (changes.length === 0) return 0;

  const total = changes.reduce((sum, change) => sum.plus(change.latestBalance), ZERO);
  const totalChange = changes.reduce((sum, change) => (change.change ? sum.plus(change.change) : sum), ZERO);
  const direction = totalChange.isNegative() ? '↓' : '↑';
  const dedupeKey = pragueDateKey(now);

  return notifyEligibleUsers(NotificationType.PORTFOLIO_DIGEST, dedupeKey, {
    title: 'Portfolio — večerní přehled',
    body: `Hodnota ${total.toFixed(0)} Kč, dnes ${direction} ${totalChange.abs().toFixed(0)} Kč.`,
    data: { type: 'portfolio-digest' },
  });
}
