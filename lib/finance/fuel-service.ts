import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

import { FUEL_DATA_CUTOFF, monthlyFuelSpend, walletBalance, type MonthlyFuelSpend } from './fuel';

export interface FuelOverview {
  monthly: MonthlyFuelSpend[];
  walletBalanceCzk: string;
  topUpCount: number;
  purchaseCount: number;
  /** Sum of every uploaded receipt's discount, matched or not — the discount was earned regardless. */
  totalDiscountCzk: string;
  receiptCount: number;
}

/**
 * Database-facing wrapper around the pure aggregation in `fuel.ts`. Top-ups
 * come from `FuelTopUp` (tankarta.cz's own "DOBITÝ KREDIT" export) — a
 * Moneta bank transaction was tried first and dropped: its merchant text
 * can't distinguish a real top-up from an unrelated Orlen charge, and its
 * posting date lags the real payment by a few days.
 *
 * `walletBalance` is computed from full history, not just FUEL_DATA_CUTOFF
 * onward: the prepaid card's real balance depends on every top-up and
 * purchase that ever happened, not only the ones inside Orbit's reporting
 * window. Only the `monthly` breakdown — a display concern, not a balance —
 * is cut down to FUEL_DATA_CUTOFF onward, per the scope decision to not
 * report on driving from before August 2026.
 */
export async function loadFuelOverview(): Promise<FuelOverview> {
  const [purchases, topUps, receipts] = await Promise.all([
    prisma.fuelPurchase.findMany({
      select: { purchasedAt: true, amountCzk: true, quantityLiters: true },
      orderBy: { purchasedAt: 'asc' },
    }),
    prisma.fuelTopUp.findMany({ select: { amountCzk: true } }),
    prisma.fuelReceipt.findMany({ select: { discountAmount: true } }),
  ]);

  const topUpAmountsCzk = topUps.map((topUp) => topUp.amountCzk);
  const purchaseAmountsCzk = purchases.map((purchase) => purchase.amountCzk);
  const totalDiscount = receipts.reduce((sum, receipt) => sum.plus(receipt.discountAmount), new Prisma.Decimal(0));
  const purchasesInReportingWindow = purchases.filter((purchase) => purchase.purchasedAt >= FUEL_DATA_CUTOFF);

  return {
    monthly: monthlyFuelSpend(purchasesInReportingWindow),
    walletBalanceCzk: walletBalance(topUpAmountsCzk, purchaseAmountsCzk).toFixed(2),
    topUpCount: topUps.length,
    purchaseCount: purchases.length,
    totalDiscountCzk: totalDiscount.toFixed(2),
    receiptCount: receipts.length,
  };
}

export interface ReceiptRow {
  id: string;
  purchasedAt: Date;
  stationName: string;
  totalAfterDiscount: string;
  discountAmount: string;
  matched: boolean;
}

/** Most recent receipts, matched or not — the "did I actually see my discounts" view. */
export async function loadRecentReceipts(limit = 20): Promise<ReceiptRow[]> {
  const receipts = await prisma.fuelReceipt.findMany({
    select: { id: true, purchasedAt: true, stationName: true, totalAfterDiscount: true, discountAmount: true, purchaseId: true },
    orderBy: { purchasedAt: 'desc' },
    take: limit,
  });

  return receipts.map((receipt) => ({
    id: receipt.id,
    purchasedAt: receipt.purchasedAt,
    stationName: receipt.stationName,
    totalAfterDiscount: receipt.totalAfterDiscount.toFixed(2),
    discountAmount: receipt.discountAmount.toFixed(2),
    matched: receipt.purchaseId !== null,
  }));
}
