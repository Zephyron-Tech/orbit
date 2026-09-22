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
          liters: row.liters.toFixed(3),
          purchases: row.purchases.map((purchase) => ({
            id: purchase.id,
            purchasedAt: purchase.purchasedAt.toISOString(),
            amountCzk: purchase.amountCzk.toFixed(2),
            quantityLiters: purchase.quantityLiters.toFixed(3),
            stationName: purchase.stationName,
            missingReceipt: purchase.missingReceipt,
          })),
        })),
      },
      receipts: receipts.map((receipt) => ({ ...receipt, purchasedAt: receipt.purchasedAt.toISOString() })),
    });
  });
