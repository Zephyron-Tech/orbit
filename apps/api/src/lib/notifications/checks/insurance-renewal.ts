import { loadInsuranceOverview } from '@orbit-api/lib/finance/insurance-service';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';

/** Fires once per policy per threshold per renewal year — 14 days out, then again at 3 days out. */
const THRESHOLDS = [14, 3] as const;

export async function checkInsuranceRenewal(now: Date): Promise<number> {
  let sent = 0;

  for (const threshold of THRESHOLDS) {
    const overview = await loadInsuranceOverview(now, threshold);

    for (const renewal of overview.upcomingRenewals) {
      const renewalYear = renewal.nextDueDate.slice(0, 4);
      const dedupeKey = `${renewal.policyId}:${threshold}:${renewalYear}`;
      const daysWord = threshold < 5 ? 'dny' : 'dní';

      sent += await notifyEligibleUsers(NotificationType.INSURANCE_RENEWAL, dedupeKey, {
        title: 'Blíží se obnova pojistky',
        body: `${renewal.vehicleName} (${renewal.licensePlate}) — obnova za ${threshold} ${daysWord}, ${renewal.nextDueDate}.`,
        data: { type: 'insurance-renewal', policyId: renewal.policyId },
      });
    }
  }

  return sent;
}
