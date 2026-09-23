import { prisma } from '@orbit-api/lib/db/prisma';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsersBatch, type NotifiableEntity } from '../notify';
import { pluralizeCs } from '../pluralize';
import { getReportingFloor } from '../reporting-floor';

const AGE_THRESHOLD_DAYS = 3;

/**
 * Two distinct senses of "missing," both surfaced today only in-app: a
 * purchase with no receipt uploaded/matched at all (`FuelPurchase.receipt`
 * null — the same `where` process-fuel-receipt.ts's rematch job uses), and a
 * receipt that was uploaded but stayed unmatched (`FuelReceipt.purchaseId`
 * null). Each fires once ever, aged past AGE_THRESHOLD_DAYS so a same-day
 * purchase doesn't nag before there's been a real chance to upload the
 * receipt.
 *
 * Batched (notifyEligibleUsersBatch): a real production run fired 340
 * individual pushes in one minute the first time this check ran against a
 * genuine backlog — every entity still gets its own SentNotification row
 * (so the in-app center lists each one with its own open/delete), but the
 * user is only interrupted with one push summarizing the count.
 */
export async function checkFuelReceiptMissing(now: Date): Promise<number> {
  const cutoff = new Date(now.getTime() - AGE_THRESHOLD_DAYS * 24 * 60 * 60 * 1000);
  const floor = await getReportingFloor();

  const [purchasesWithoutReceipt, unmatchedReceipts] = await Promise.all([
    prisma.fuelPurchase.findMany({
      where: { receipt: null, purchasedAt: { lte: cutoff, ...(floor ? { gte: floor } : {}) } },
      select: { id: true, purchasedAt: true, stationName: true, amountCzk: true },
    }),
    prisma.fuelReceipt.findMany({
      where: { purchaseId: null, purchasedAt: { lte: cutoff, ...(floor ? { gte: floor } : {}) } },
      select: { id: true, purchasedAt: true, stationName: true, totalAfterDiscount: true },
    }),
  ]);

  const entities: NotifiableEntity[] = [
    ...purchasesWithoutReceipt.map((purchase): NotifiableEntity => ({
      dedupeKey: `purchase:${purchase.id}`,
      title: 'Chybí účtenka za palivo',
      body: `Nákup ${purchase.amountCzk.toFixed(0)} Kč na ${purchase.stationName} ze dne ${purchase.purchasedAt.toISOString().slice(0, 10)} nemá nahranou účtenku.`,
      data: { type: 'fuel-receipt-missing', kind: 'purchase', fuelPurchaseId: purchase.id },
    })),
    ...unmatchedReceipts.map((receipt): NotifiableEntity => ({
      dedupeKey: `receipt:${receipt.id}`,
      title: 'Nespárovaná účtenka za palivo',
      body: `Účtenka ${receipt.totalAfterDiscount.toFixed(0)} Kč z ${receipt.stationName} ze dne ${receipt.purchasedAt.toISOString().slice(0, 10)} zatím není spárovaná s nákupem.`,
      data: { type: 'fuel-receipt-missing', kind: 'receipt', fuelReceiptId: receipt.id },
    })),
  ];

  return notifyEligibleUsersBatch(NotificationType.FUEL_RECEIPT_MISSING, entities, (newEntities) => ({
    title: 'Palivo — chybí doklady',
    body: `${newEntities.length} ${pluralizeCs(newEntities.length, 'položka čeká', 'položky čekají', 'položek čeká')} na doplnění nebo spárování účtenky.`,
    data: { type: 'fuel-receipt-missing-batch', count: newEntities.length },
  }));
}
