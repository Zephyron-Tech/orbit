import { Hono } from 'hono';

import { rebuildMonthlyNetWorth } from '@orbit-api/lib/finance/monthly-net-worth-service';
import { recordNetWorthSnapshot } from '@orbit-api/lib/finance/net-worth-service';
import { matchPendingTransfers } from '@orbit-api/lib/import/transfer-sync';
import { syncTrading212Income } from '@orbit-api/lib/providers/trading212/income-sync';
import { syncTrading212, Trading212SyncError } from '@orbit-api/lib/providers/trading212/sync';
import { getEnv } from '@orbit-api/lib/validation/env';
import { cronAuth } from '@orbit-api/middleware/cron-auth';

export const cron = new Hono()
  .use('*', cronAuth)
  .on(['GET', 'POST'], '/net-worth-snapshot', async (c) => {
    try {
      return c.json(await recordNetWorthSnapshot());
    } catch (error: unknown) {
      console.error('Net worth snapshot failed', error);
      return c.json({ error: 'Snapshot failed' }, 500);
    }
  })
  .on(['GET', 'POST'], '/sync-trading212', async (c) => {
    const env = getEnv();

    if (!env.TRADING212_API_KEY_ID || !env.TRADING212_API_SECRET) {
      return c.json({ error: 'TRADING212_API_KEY_ID and TRADING212_API_SECRET must be configured' }, 503);
    }

    try {
      const result = await syncTrading212({ keyId: env.TRADING212_API_KEY_ID, secret: env.TRADING212_API_SECRET, baseUrl: env.TRADING212_API_BASE_URL });

      // Best-effort and reported alongside, not instead of, the price sync:
      // a dividend-history hiccup must not make the primary portfolio value
      // look like it failed to update.
      let income: Awaited<ReturnType<typeof syncTrading212Income>> | null = null;
      let incomeError: string | null = null;

      try {
        income = await syncTrading212Income({ keyId: env.TRADING212_API_KEY_ID, secret: env.TRADING212_API_SECRET, baseUrl: env.TRADING212_API_BASE_URL });
        await matchPendingTransfers();
        void rebuildMonthlyNetWorth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), new Date()).catch((error: unknown) =>
          console.error('Monthly net-worth rebuild failed after cron sync', error),
        );
      } catch (error: unknown) {
        incomeError = error instanceof Error ? error.message : 'Income sync failed';
        console.error('Trading 212 income sync failed', error);
      }

      return c.json({ ...result, income, incomeError });
    } catch (error: unknown) {
      if (error instanceof Trading212SyncError) return c.json({ error: error.message, code: error.code }, error.code === 'API_ERROR' ? 502 : 400);
      console.error('Trading 212 sync failed', error);
      return c.json({ error: 'Sync failed' }, 500);
    }
  });
