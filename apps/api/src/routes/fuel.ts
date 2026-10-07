import { Hono } from 'hono';

import { loadFuelOverview, loadRecentReceipts } from '@orbit-api/lib/finance/fuel-service';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

export const fuel = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const [overview, receipts] = await Promise.all([loadFuelOverview(), loadRecentReceipts()]);
    return c.json({
      overview: {
        ...overview,
        monthly: overview.monthly.map((row) => ({
          month: row.month,
          totalCzk: row.totalCzk.toFixed(2),
          liters: row.liters.toFixed(2),
          purchases: row.purchases.map((purchase) => ({
            id: purchase.id,
            purchasedAt: purchase.purchasedAt.toISOString(),
            amountCzk: purchase.amountCzk.toFixed(2),
            quantityLiters: purchase.quantityLiters.toFixed(2),
            stationName: purchase.stationName,
            missingReceipt: purchase.missingReceipt,
          })),
        })),
        monthlyDiscount: overview.monthlyDiscount.map((row) => ({ month: row.month, discountCzk: row.discountCzk.toFixed(2) })),
      },
      receipts: receipts.map((receipt) => ({ ...receipt, purchasedAt: receipt.purchasedAt.toISOString() })),
    });
  });
