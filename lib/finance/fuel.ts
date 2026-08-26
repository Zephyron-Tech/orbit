import { Prisma } from '@/lib/generated/prisma/client';

/**
 * Actual monthly fuel spend from Orlen Tankkarta purchase records. Pure:
 * inputs in, numbers out. No Prisma, no clock.
 *
 * The Moneta wallet top-up transaction is attributed to whichever month the
 * top-up happened, not the month the fuel was actually bought — a July
 * top-up can fund driving into August. `FuelPurchase` rows (from the
 * tankkarta.cz export) are the ground truth for when the money was actually
 * spent, so this groups by purchase date directly instead of top-up date.
 * `walletBalance` is a simple running total (all top-ups minus all
 * purchases), not a FIFO ledger matching individual top-ups to individual
 * purchases — the monthly figures below already answer "how much did I
 * actually spend on fuel this month" without needing that.
 */

const ZERO = new Prisma.Decimal(0);

export interface FuelPurchaseAmount {
  purchasedAt: Date;
  amountCzk: Prisma.Decimal;
  quantityLiters: Prisma.Decimal;
}

export interface MonthlyFuelSpend {
  /** UTC calendar month, "YYYY-MM". */
  month: string;
  totalCzk: Prisma.Decimal;
  liters: Prisma.Decimal;
}

export function monthlyFuelSpend(purchases: readonly FuelPurchaseAmount[]): MonthlyFuelSpend[] {
  const byMonth = new Map<string, { totalCzk: Prisma.Decimal; liters: Prisma.Decimal }>();

  for (const purchase of purchases) {
    const month = purchase.purchasedAt.toISOString().slice(0, 7);
    const existing = byMonth.get(month) ?? { totalCzk: ZERO, liters: ZERO };

    byMonth.set(month, {
      totalCzk: existing.totalCzk.plus(purchase.amountCzk),
      liters: existing.liters.plus(purchase.quantityLiters),
    });
  }

  return [...byMonth.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([month, totals]) => ({ month, ...totals }));
}

/**
 * All-time top-ups minus all-time actual purchases — a sanity-check display
 * ("~X Kč remains on the card"), not a precise per-top-up ledger.
 * `topUpAmountsCzk` are signed Moneta amounts (expenses are negative, per
 * Orbit's sign convention); `purchaseAmountsCzk` are the unsigned
 * `FuelPurchase.amountCzk` values.
 */
export function walletBalance(
  topUpAmountsCzk: readonly Prisma.Decimal[],
  purchaseAmountsCzk: readonly Prisma.Decimal[],
): Prisma.Decimal {
  const totalTopUps = topUpAmountsCzk.reduce((sum, amount) => sum.plus(amount.abs()), ZERO);
  const totalPurchases = purchaseAmountsCzk.reduce((sum, amount) => sum.plus(amount), ZERO);

  return totalTopUps.minus(totalPurchases);
}
