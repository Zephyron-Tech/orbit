import { Hono } from 'hono';

import { rebuildMonthlyNetWorth } from '@orbit-api/lib/finance/monthly-net-worth-service';
import { matchPendingTransfers } from '@orbit-api/lib/import/transfer-sync';
import { syncTrading212Income } from '@orbit-api/lib/providers/trading212/income-sync';
import { syncTrading212, Trading212SyncError } from '@orbit-api/lib/providers/trading212/sync';
import { getEnv } from '@orbit-api/lib/validation/env';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

export const portfolio = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .post('/refresh', async (c) => {
    const env = getEnv();

    if (!env.TRADING212_API_KEY_ID || !env.TRADING212_API_SECRET) {
      return c.json({ error: 'Trading 212 API klíč není nastaven' }, 422);
    }

    try {
      const result = await syncTrading212({ keyId: env.TRADING212_API_KEY_ID, secret: env.TRADING212_API_SECRET, baseUrl: env.TRADING212_API_BASE_URL });

      // Best-effort, same as after every CSV import: the caller's spinner
      // clears as soon as the portfolio numbers it's watching are done, not
      // stay stuck through income sync + transfer matching too.
      void (async () => {
        try {
          await syncTrading212Income({ keyId: env.TRADING212_API_KEY_ID, secret: env.TRADING212_API_SECRET, baseUrl: env.TRADING212_API_BASE_URL });
          await matchPendingTransfers();
        } catch (error: unknown) {
          console.error('Trading 212 income sync/transfer matching failed after portfolio sync', error);
        }

        await rebuildMonthlyNetWorth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), new Date()).catch((error: unknown) =>
          console.error('Monthly net-worth rebuild failed after portfolio sync', error),
        );
      })();

      return c.json({ ok: true, capturedAt: result.capturedAt });
    } catch (error: unknown) {
      if (error instanceof Trading212SyncError) return c.json({ error: error.message }, 502);
      console.error('Manual portfolio refresh failed', error);
      return c.json({ error: 'Synchronizace selhala' }, 500);
    }
  });
