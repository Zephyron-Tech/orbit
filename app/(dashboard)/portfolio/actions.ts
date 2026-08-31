'use server';

import { revalidatePath } from 'next/cache';

import { getActiveUser } from '@/lib/auth';
import { syncTrading212Income } from '@/lib/providers/trading212/income-sync';
import { syncTrading212, Trading212SyncError } from '@/lib/providers/trading212/sync';
import { matchPendingTransfers } from '@/lib/import/transfer-sync';
import { rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';
import { getEnv } from '@/lib/validation/env';

export interface RefreshResult {
  ok: boolean;
  error?: string;
  capturedAt?: string;
}

/**
 * Manual pull, for "I just want to see this now" rather than waiting for the
 * hourly cron. Same underlying sync, so it shares its idempotency: clicking
 * twice inside the same hour is a no-op, not a second snapshot.
 */
export async function refreshPortfolio(): Promise<RefreshResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const env = getEnv();

  if (!env.TRADING212_API_KEY_ID || !env.TRADING212_API_SECRET) {
    return { ok: false, error: 'Trading 212 API klíč není nastaven' };
  }

  try {
    const result = await syncTrading212({
      keyId: env.TRADING212_API_KEY_ID,
      secret: env.TRADING212_API_SECRET,
      baseUrl: env.TRADING212_API_BASE_URL,
    });

    revalidatePath('/portfolio');
    revalidatePath('/net-worth');

    // Best-effort, same as after every CSV import: the button's spinner must
    // clear as soon as the portfolio numbers the user is watching are done,
    // not stay stuck through income sync + transfer matching too — those
    // keep happening the same way in the background regardless.
    void (async () => {
      try {
        await syncTrading212Income({
          keyId: env.TRADING212_API_KEY_ID,
          secret: env.TRADING212_API_SECRET,
          baseUrl: env.TRADING212_API_BASE_URL,
        });
        await matchPendingTransfers();
        revalidatePath('/transactions');
      } catch (error: unknown) {
        console.error('Trading 212 income sync/transfer matching failed after portfolio sync', error);
      }

      await rebuildMonthlyNetWorth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), new Date()).catch(
        (error: unknown) => console.error('Monthly net-worth rebuild failed after portfolio sync', error),
      );
    })();

    return { ok: true, capturedAt: result.capturedAt };
  } catch (error: unknown) {
    if (error instanceof Trading212SyncError) {
      return { ok: false, error: error.message };
    }

    console.error('Manual portfolio refresh failed', error);

    return { ok: false, error: 'Synchronizace selhala' };
  }
}
