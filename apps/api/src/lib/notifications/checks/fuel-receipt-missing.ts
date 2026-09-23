import { prisma } from '@orbit-api/lib/db/prisma';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';
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

  let sent = 0;

  for (const purchase of purchasesWithoutReceipt) {
    const dedupeKey = `purchase:${purchase.id}`;
    sent += await notifyEligibleUsers(NotificationType.FUEL_RECEIPT_MISSING, dedupeKey, {
      title: 'Chybí účtenka za palivo',
      body: `Nákup ${purchase.amountCzk.toFixed(0)} Kč na ${purchase.stationName} ze dne ${purchase.purchasedAt.toISOString().slice(0, 10)} nemá nahranou účtenku.`,
      data: { type: 'fuel-receipt-missing', kind: 'purchase', fuelPurchaseId: purchase.id },
    });
  }

  for (const receipt of unmatchedReceipts) {
    const dedupeKey = `receipt:${receipt.id}`;
    sent += await notifyEligibleUsers(NotificationType.FUEL_RECEIPT_MISSING, dedupeKey, {
      title: 'Nespárovaná účtenka za palivo',
      body: `Účtenka ${receipt.totalAfterDiscount.toFixed(0)} Kč z ${receipt.stationName} ze dne ${receipt.purchasedAt.toISOString().slice(0, 10)} zatím není spárovaná s nákupem.`,
      data: { type: 'fuel-receipt-missing', kind: 'receipt', fuelReceiptId: receipt.id },
    });
  }

  return sent;
}
