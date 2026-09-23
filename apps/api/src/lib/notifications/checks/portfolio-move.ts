import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { loadInvestmentAccountDailyChanges } from '../portfolio-snapshots';
import { pragueDateKey } from '../time';

const THRESHOLD_PERCENT = 3;

export async function checkPortfolioMove(now: Date): Promise<number> {
  const changes = await loadInvestmentAccountDailyChanges(now);
  const dateKey = pragueDateKey(now);

  let sent = 0;
  for (const change of changes) {
    if (!change.changePercent || change.changePercent.abs().lessThan(THRESHOLD_PERCENT)) continue;

    const direction = change.changePercent.isNegative() ? 'klesl' : 'vzrostl';
    const dedupeKey = `${change.accountId}:${dateKey}`;

    sent += await notifyEligibleUsers(NotificationType.BIG_PORTFOLIO_MOVE, dedupeKey, {
      title: 'Velký pohyb portfolia',
      body: `${change.accountName} dnes ${direction} o ${change.changePercent.abs().toFixed(1)} % (${change.change?.abs().toFixed(0) ?? '0'} Kč).`,
      data: { type: 'portfolio-move', accountId: change.accountId },
    });
  }
  return sent;
}
