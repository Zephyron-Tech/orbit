import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { MonetaSyncError, processMonetaSyncTransactions } from '@/lib/import/process-moneta-sync';
import { getEnv } from '@/lib/validation/env';

/**
 * Machine-to-machine endpoint for the Moneta live-sync bot (mac-automation):
 * a JSON body of transactions scraped straight from Moneta's internet
 * banking, not a file — see docs/moneta-sync-ingest-api.md for the contract.
 * One call per account per sync run.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_TRANSACTIONS = 500;

const transactionSchema = z.object({
  transactionId: z.string().trim().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum musí být ve tvaru YYYY-MM-DD'),
  amount: z.string().regex(/^-?\d+(\.\d{1,4})?$/, 'Částka musí být desetinné číslo s tečkou'),
  currency: z.string().length(3),
  merchant: z.string().nullable(),
  description: z.string().nullable(),
  counterAccount: z.string().nullable(),
  sourceCategory: z.string().nullable(),
});

const bodySchema = z.object({
  accountId: z.uuid(),
  balance: z
    .string()
    .regex(/^-?\d+(\.\d{1,4})?$/, 'Zůstatek musí být desetinné číslo s tečkou')
    .optional(),
  transactions: z.array(transactionSchema).min(1).max(MAX_TRANSACTIONS),
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
      accountId: parsedBody.data.accountId,
      balance: parsedBody.data.balance ?? null,
      transactions: parsedBody.data.transactions,
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
