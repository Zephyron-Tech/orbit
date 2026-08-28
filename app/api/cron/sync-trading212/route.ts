import { NextResponse } from 'next/server';

import { syncTrading212Income } from '@/lib/providers/trading212/income-sync';
import { syncTrading212, Trading212SyncError } from '@/lib/providers/trading212/sync';
import { matchPendingTransfers } from '@/lib/import/transfer-sync';
import { rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';
import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { getEnv } from '@/lib/validation/env';

// Prisma and the provider client need the Node.js runtime.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<NextResponse> {
  const env = getEnv();

  // Checked before anything else happens: this route has no session.
  if (!isIngestionAuthorized(request, env.INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  if (!env.TRADING212_API_KEY_ID || !env.TRADING212_API_SECRET) {
    return NextResponse.json(
      { error: 'TRADING212_API_KEY_ID and TRADING212_API_SECRET must be configured' },
      { status: 503 },
    );
  }

  try {
    const result = await syncTrading212({
      keyId: env.TRADING212_API_KEY_ID,
      secret: env.TRADING212_API_SECRET,
      baseUrl: env.TRADING212_API_BASE_URL,
    });

    // Best-effort and reported alongside, not instead of, the price sync: a
    // dividend-history hiccup must not make the primary portfolio value look
    // like it failed to update.
    let income: Awaited<ReturnType<typeof syncTrading212Income>> | null = null;
    let incomeError: string | null = null;

    try {
      income = await syncTrading212Income({
        keyId: env.TRADING212_API_KEY_ID,
        secret: env.TRADING212_API_SECRET,
        baseUrl: env.TRADING212_API_BASE_URL,
      });
      await matchPendingTransfers();
      void rebuildMonthlyNetWorth(new Date(Date.UTC(new Date().getUTCFullYear(), new Date().getUTCMonth(), 1)), new Date()).catch((error: unknown) => console.error('Monthly net-worth rebuild failed after cron sync', error));
    } catch (error: unknown) {
      incomeError = error instanceof Error ? error.message : 'Income sync failed';
      console.error('Trading 212 income sync failed', error);
    }

    return NextResponse.json({ ...result, income, incomeError });
  } catch (error: unknown) {
    if (error instanceof Trading212SyncError) {
      const status = error.code === 'API_ERROR' ? 502 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Trading 212 sync failed', error);

    return NextResponse.json({ error: 'Sync failed' }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

/** Vercel Cron issues GET; POST is here for manual triggering. */
export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
