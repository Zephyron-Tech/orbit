import { prisma } from '@orbit-api/lib/db/prisma';
import { isActionableTransfer } from '@orbit-api/lib/finance/data-confidence';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsersBatch, type NotifiableEntity } from '../notify';
import { pluralizeCs } from '../pluralize';
import { getReportingFloor } from '../reporting-floor';
import { pragueIsoWeekKey } from '../time';

const STUCK_AFTER_DAYS = 5;

export async function checkUnmatchedTransferStuck(now: Date): Promise<number> {
  const floor = await getReportingFloor();
  const settings = await prisma.planningSettings.findUnique({ where: { id: 'household' }, select: { transferHistoryFrom: true } });
  const firstBankBatch = await prisma.importBatch.findFirst({
    where: { status: 'COMPLETED', account: { provider: { not: 'TRADING212' } }, periodFrom: { not: null } },
    orderBy: { periodFrom: 'asc' },
    select: { periodFrom: true },
  });
  const transferHistoryFrom = settings?.transferHistoryFrom ?? firstBankBatch?.periodFrom ?? null;

  const rows = await prisma.transaction.findMany({
    where: { kind: { in: ['INTERNAL_TRANSFER', 'PENDING_TRANSFER'] }, transferId: null, transferDismissedAt: null },
    select: { id: true, date: true, amount: true, currency: true, merchant: true, account: { select: { provider: true, name: true } } },
  });

  const cutoff = new Date(now.getTime() - STUCK_AFTER_DAYS * 24 * 60 * 60 * 1000);
  const weekKey = pragueIsoWeekKey(now);

  const entities: NotifiableEntity[] = [];
  for (const row of rows) {
    if (row.date.getTime() > cutoff.getTime()) continue;
    if (floor && row.date.getTime() < floor.getTime()) continue;
    if (!isActionableTransfer({ date: row.date, provider: row.account.provider }, transferHistoryFrom)) continue;

    entities.push({
      dedupeKey: `${row.id}:${weekKey}`,
      title: 'Nespárovaný převod',
      body: `${row.account.name} — ${row.amount.abs().toFixed(0)} ${row.currency} ze dne ${row.date.toISOString().slice(0, 10)} stále čeká na protistranu.`,
      data: { type: 'unmatched-transfer', transactionId: row.id },
    });
  }

  return notifyEligibleUsersBatch(NotificationType.UNMATCHED_TRANSFER_STUCK, entities, (newEntities) => ({
    title: 'Nespárované převody',
    body: `${newEntities.length} ${pluralizeCs(newEntities.length, 'převod stále čeká', 'převody stále čekají', 'převodů stále čeká')} na protistranu.`,
    data: { type: 'unmatched-transfer-batch', count: newEntities.length },
  }));
}
