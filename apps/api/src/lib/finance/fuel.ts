import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Actual monthly fuel spend from Orlen Tankarta purchase records. Pure:
 * inputs in, numbers out. No Prisma, no clock.
 *
 * A Moneta bank transaction is attributed to whichever month it posted, not
 * the month the fuel was actually bought or the top-up actually happened —
 * a July top-up can fund driving into August, and bank posting dates lag
 * the real payment by a few days regardless. `FuelPurchase`/`FuelTopUp` rows
 * (both from tankarta.cz's own exports) are the ground truth for when the
 * money actually moved, so this groups by that date directly. `walletBalance`
 * is a simple running total (all top-ups minus all purchases), not a FIFO
 * ledger matching individual top-ups to individual purchases — the monthly
 * figures below already answer "how much did I actually spend on fuel this
 * month" without needing that.
 */

const ZERO = new Prisma.Decimal(0);

/**
 * Fuel *reporting* only covers August 2026 onward — the user doesn't want
 * older tankarta.cz driving history (back to 2020) shown in the monthly
 * breakdown. Applied at display time only (`fuel-service.ts`'s `monthly`),
 * not at import: `walletBalance` needs full history to be correct, since a
 * prepaid card's real balance depends on every top-up and purchase that
 * ever happened, not just the ones inside the reporting window. An earlier
 * version filtered at import time and undercounted the wallet balance by
 * exactly the pre-cutoff carryover as a result.
 */
export const FUEL_DATA_CUTOFF = new Date('2026-08-01T00:00:00.000Z');

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
 * ("~X Kč remains on the card"), not a precise per-top-up ledger. Both
 * inputs are unsigned amounts (`FuelTopUp.amountCzk`, `FuelPurchase.amountCzk`).
 */
export function walletBalance(
  topUpAmountsCzk: readonly Prisma.Decimal[],
  purchaseAmountsCzk: readonly Prisma.Decimal[],
): Prisma.Decimal {
  const totalTopUps = topUpAmountsCzk.reduce((sum, amount) => sum.plus(amount), ZERO);
  const totalPurchases = purchaseAmountsCzk.reduce((sum, amount) => sum.plus(amount), ZERO);

  return totalTopUps.minus(totalPurchases);
}
