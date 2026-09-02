import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { ImportError, processCsvImport } from '@/lib/import/process-csv';
import { getEnv } from '@/lib/validation/env';

/**
 * Machine-to-machine counterpart of `app/api/import/csv/route.ts`, for the
 * bank-statement automation bot: the bank now sends every statement (current,
 * savings, EUR, credit card) as a PDF by mail, so this is the bot's only way
 * in. `processCsvImport` already sniffs and parses PDF statements — this
 * route is transport only, authorized by `BANK_STATEMENT_INGESTION_SECRET`
 * instead of a browser session.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A monthly statement PDF is a few hundred KB; this is a generous ceiling. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const formSchema = z.object({
  accountId: z.uuid(),
  dryRun: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
});

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();

  // Checked before anything else happens: this route has no session.
  if (!isIngestionAuthorized(request, env.BANK_STATEMENT_INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: 'Očekáván multipart/form-data' }, { status: 400 });
  }

  const parsedForm = formSchema.safeParse({
    accountId: formData.get('account_id'),
    dryRun: formData.get('dryRun') ?? undefined,
  });

  if (!parsedForm.success) {
    return NextResponse.json({ error: 'Chybí platné ID účtu' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím PDF výpis' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Soubor je prázdný' }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Soubor je větší než 5 MB' }, { status: 413 });
  }

  if (!file.name.toLowerCase().endsWith('.pdf')) {
    return NextResponse.json({ error: 'Podporován je pouze soubor .pdf' }, { status: 415 });
  }

  try {
    const summary = await processCsvImport({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      accountId: parsedForm.data.accountId,
      dryRun: parsedForm.data.dryRun,
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof ImportError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Bank statement ingest failed', error);

    return NextResponse.json({ error: 'Import se nezdařil' }, { status: 500 });
  }
}
