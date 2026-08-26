import { prisma } from '@/lib/db/prisma';
import { isOrlenTopUp } from '@/lib/import/internal-transfers';

import { monthlyFuelSpend, walletBalance, type MonthlyFuelSpend } from './fuel';

export interface FuelOverview {
  monthly: MonthlyFuelSpend[];
  walletBalanceCzk: string;
  topUpCount: number;
  purchaseCount: number;
}

/**
 * Database-facing wrapper around the pure aggregation in `fuel.ts`.
 * Top-up detection (`isOrlenTopUp`) only reads Moneta transactions already
 * in the ledger — it never writes anything, so an occasional heuristic miss
 * only affects this report's wallet-balance number, not the ledger itself.
 */
export async function loadFuelOverview(): Promise<FuelOverview> {
  const [purchases, candidateTopUps] = await Promise.all([
    prisma.fuelPurchase.findMany({
      select: { purchasedAt: true, amountCzk: true, quantityLiters: true },
      orderBy: { purchasedAt: 'asc' },
    }),
    prisma.transaction.findMany({
      where: { kind: 'NORMAL', amount: { lt: 0 } },
      select: { merchant: true, description: true, amount: true, amountCzk: true, currency: true },
    }),
  ]);

  const topUps = candidateTopUps.filter((transaction) => isOrlenTopUp(transaction.merchant, transaction.description, transaction.amount.toString()));
  const topUpAmountsCzk = topUps.map((transaction) => (transaction.currency === 'CZK' ? transaction.amount : (transaction.amountCzk ?? transaction.amount)));
  const purchaseAmountsCzk = purchases.map((purchase) => purchase.amountCzk);

  return {
    monthly: monthlyFuelSpend(purchases),
    walletBalanceCzk: walletBalance(topUpAmountsCzk, purchaseAmountsCzk).toFixed(2),
    topUpCount: topUps.length,
    purchaseCount: purchases.length,
  };
}

export interface UnmatchedReceipt {
  id: string;
  purchasedAt: Date;
  stationName: string;
  totalAfterDiscount: string;
  discountAmount: string;
}

export async function loadUnmatchedReceipts(): Promise<UnmatchedReceipt[]> {
  const receipts = await prisma.fuelReceipt.findMany({
    where: { purchaseId: null },
    select: { id: true, purchasedAt: true, stationName: true, totalAfterDiscount: true, discountAmount: true },
    orderBy: { purchasedAt: 'desc' },
  });

  return receipts.map((receipt) => ({
    ...receipt,
    totalAfterDiscount: receipt.totalAfterDiscount.toFixed(2),
    discountAmount: receipt.discountAmount.toFixed(2),
  }));
}
