import { prisma } from '@orbit-api/lib/db/prisma';
import { isActionableTransfer } from '@orbit-api/lib/finance/data-confidence';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
import { pragueIsoWeekKey } from '../time';

const STUCK_AFTER_DAYS = 5;

export async function checkUnmatchedTransferStuck(now: Date): Promise<number> {
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

  let sent = 0;
  for (const row of rows) {
    if (row.date.getTime() > cutoff.getTime()) continue;
    if (!isActionableTransfer({ date: row.date, provider: row.account.provider }, transferHistoryFrom)) continue;

    const dedupeKey = `${row.id}:${weekKey}`;
    sent += await notifyEligibleUsers(NotificationType.UNMATCHED_TRANSFER_STUCK, dedupeKey, {
      title: 'Nespárovaný převod',
      body: `${row.account.name} — ${row.amount.abs().toFixed(0)} ${row.currency} ze dne ${row.date.toISOString().slice(0, 10)} stále čeká na protistranu.`,
      data: { type: 'unmatched-transfer', transactionId: row.id },
    });
  }
  return sent;
}
