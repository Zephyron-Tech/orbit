import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { isOrlenTopUp } from '@/lib/import/internal-transfers';

import { monthlyFuelSpend, walletBalance, type MonthlyFuelSpend } from './fuel';

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
 * Database-facing wrapper around the pure aggregation in `fuel.ts`.
 * Top-up detection (`isOrlenTopUp`) only reads Moneta transactions already
 * in the ledger — it never writes anything, so an occasional heuristic miss
 * only affects this report's wallet-balance number, not the ledger itself.
 */
export async function loadFuelOverview(): Promise<FuelOverview> {
  const [purchases, candidateTopUps, receipts] = await Promise.all([
    prisma.fuelPurchase.findMany({
      select: { purchasedAt: true, amountCzk: true, quantityLiters: true },
      orderBy: { purchasedAt: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { kind: 'NORMAL', amount: { lt: 0 } },
      select: { merchant: true, description: true, amount: true, amountCzk: true, currency: true },
    }),
    prisma.fuelReceipt.findMany({ select: { discountAmount: true } }),
  ]);

  const topUps = candidateTopUps.filter((transaction) => isOrlenTopUp(transaction.merchant, transaction.description, transaction.amount.toString()));
  const topUpAmountsCzk = topUps.map((transaction) => (transaction.currency === 'CZK' ? transaction.amount : (transaction.amountCzk ?? transaction.amount)));
  const purchaseAmountsCzk = purchases.map((purchase) => purchase.amountCzk);
  const totalDiscount = receipts.reduce((sum, receipt) => sum.plus(receipt.discountAmount), new Prisma.Decimal(0));

  return {
    monthly: monthlyFuelSpend(purchases),
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
