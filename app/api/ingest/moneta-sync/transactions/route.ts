import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { MonetaSyncError, processMonetaSyncTransactions } from '@/lib/import/process-moneta-sync';
import { getEnv } from '@/lib/validation/env';

/**
 * Machine-to-machine endpoint for the Moneta email-fallback bot
 * (mac-automation, `moneta-sync`): one transaction per call, parsed from a
 * Moneta "Info Servis" notification e-mail — see
 * docs/moneta-sync-ingest-api.md for the contract. `transaction_id` is
 * always `null` on this source (an Info Servis e-mail carries no bank
 * reference), so every row dedups via `buildIdempotencyKey`'s ATTRIBUTES
 * fallback — accepted here as a known, documented limitation, same trade-off
 * CLAUDE.md already describes for any reference-less source.
 *
 * The earlier on-demand live-scrape design (Playwright login against
 * ib.moneta.cz) was cancelled — that site runs behind F5 Bot Defense, and
 * automating past a bank's own fraud/anti-bot defense is a real account-risk,
 * not a technical problem to solve around. See
 * docs/moneta-ondemand-sync-spec.md for the history.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  transaction_id: z.string().trim().min(1).nullable(),
  account_id: z.uuid(),
  amount: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'amount musí být desetinný řetězec s tečkou, ne číslo'),
  currency: z.string().length(3),
  booked_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'booked_date musí být ve tvaru YYYY-MM-DD'),
  counterparty: z.string().trim().min(1).nullable(),
  source: z.string().trim().min(1),
  dryRun: z.boolean().optional().default(true),
});

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();

  if (!isIngestionAuthorized(request, env.MONETA_SYNC_INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body: unknown = await request.json().catch(() => null);

  if (body === null) {
    return NextResponse.json({ error: 'Očekáván JSON' }, { status: 400 });
  }

  const parsedBody = bodySchema.safeParse(body);

  if (!parsedBody.success) {
    return NextResponse.json({ error: parsedBody.error.issues[0]?.message ?? 'Neplatný požadavek' }, { status: 400 });
  }

  try {
    const summary = await processMonetaSyncTransactions({
      accountId: parsedBody.data.account_id,
      dryRun: parsedBody.data.dryRun,
      transactions: [
        {
          transactionId: parsedBody.data.transaction_id,
          date: parsedBody.data.booked_date,
          amount: parsedBody.data.amount,
          currency: parsedBody.data.currency,
          merchant: parsedBody.data.counterparty,
          description: null,
          counterAccount: null,
          sourceCategory: null,
          sourceTag: parsedBody.data.source,
        },
      ],
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof MonetaSyncError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Moneta sync ingest failed', error);

    return NextResponse.json({ error: 'Zpracování se nezdařilo' }, { status: 500 });
  }
}
