import { prisma } from '@orbit-api/lib/db/prisma';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';
import { findCoverageGaps } from '@orbit-api/lib/import/coverage';

import { notifyEligibleUsers } from '../notify';

export async function checkStatementCoverageGap(): Promise<number> {
  const batches = await prisma.importBatch.findMany({
    select: { accountId: true, coverageFrom: true, coverageTo: true, account: { select: { name: true } } },
  });

  const byAccount = new Map<string, { name: string; batches: typeof batches }>();
  for (const batch of batches) {
    const entry = byAccount.get(batch.accountId) ?? { name: batch.account.name, batches: [] };
    entry.batches.push(batch);
    byAccount.set(batch.accountId, entry);
  }

  let sent = 0;
  for (const [accountId, { name, batches: accountBatches }] of byAccount) {
    const gaps = findCoverageGaps(accountBatches);

    for (const gap of gaps) {
      const dedupeKey = `${accountId}:${gap.from}:${gap.to}`;
      sent += await notifyEligibleUsers(NotificationType.STATEMENT_COVERAGE_GAP, dedupeKey, {
        title: 'Mezera ve výpisech',
        body: `${name} — chybí výpis za období ${gap.from} až ${gap.to}.`,
        data: { type: 'coverage-gap', accountId },
      });
    }
  }
  return sent;
}
