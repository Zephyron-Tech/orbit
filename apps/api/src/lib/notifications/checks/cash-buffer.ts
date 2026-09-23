import { loadInsuranceOverview } from '@orbit-api/lib/finance/insurance-service';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueDateKey } from '../time';

/**
 * Reuses loadInsuranceOverview's savingsSurplus/sinkingFundCovered — the
 * same "real savings balance minus emergency-reserve requirement" figure
 * already shown on the dashboard's insurance card ("Rezerva na spořáku
 * nestačí"), rather than a second, differently-defined buffer calculation.
 * Household-wide (the reserve is one pot, not per-account), so this fires
 * at most once per day for the household, not per account.
 */
export async function checkCashBufferLow(now: Date): Promise<number> {
  const overview = await loadInsuranceOverview(now);
  if (overview.sinkingFundCovered) return 0;

  const dedupeKey = `household:${pragueDateKey(now)}`;

  return notifyEligibleUsers(NotificationType.CASH_BUFFER_LOW, dedupeKey, {
    title: 'Rezerva na spořáku nestačí',
    body: `Chybí ${Number(overview.sinkingFundShortfall).toFixed(0)} Kč do cíle rezervy.`,
    data: { type: 'cash-buffer-low' },
  });
}
