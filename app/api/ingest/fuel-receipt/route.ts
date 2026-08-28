import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { FuelReceiptError, processFuelReceiptUpload, type FuelReceiptSummary } from '@/lib/import/process-fuel-receipt';
import { getEnv } from '@/lib/validation/env';

/**
 * Machine-to-machine counterpart of `app/api/import/fuel-receipt/route.ts` —
 * same validation and the same `processFuelReceiptUpload` underneath, but
 * authorized by `FUEL_INGESTION_SECRET` (bearer token) instead of a browser
 * session, for the Tankarta automation bot running on its own machine.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A single-page receipt PDF is a few hundred KB at most. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;
/** A generous ceiling for one batch upload — a whole month of fill-ups, not the entire history. */
const MAX_FILES = 30;

const formSchema = z.object({
  dryRun: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
});

export type FuelReceiptFileResult = ({ ok: true } & FuelReceiptSummary & { filename: string }) | { ok: false; filename: string; error: string; code: string };

export async function POST(request: Request): Promise<NextResponse> {
  const env = getEnv();

  // Checked before anything else happens: this route has no session.
  if (!isIngestionAuthorized(request, env.FUEL_INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: 'Očekáván multipart/form-data' }, { status: 400 });
  }

  const parsedForm = formSchema.safeParse({ dryRun: formData.get('dryRun') ?? undefined });

  if (!parsedForm.success) {
    return NextResponse.json({ error: 'Neplatný požadavek' }, { status: 400 });
  }

  const files = formData.getAll('file');

  if (files.length === 0 || !files.every((file) => file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím alespoň jednu účtenku ve formátu PDF' }, { status: 400 });
  }

  if (files.length > MAX_FILES) {
    return NextResponse.json({ error: `Nahrajte prosím nejvýše ${MAX_FILES} souborů najednou` }, { status: 400 });
  }

  const results: FuelReceiptFileResult[] = [];

  for (const file of files) {
    if (file.size === 0) {
      results.push({ ok: false, filename: file.name, error: 'Soubor je prázdný', code: 'BAD_FORMAT' });
      continue;
    }

    if (file.size > MAX_FILE_BYTES) {
      results.push({ ok: false, filename: file.name, error: 'Soubor je větší než 5 MB', code: 'BAD_FORMAT' });
      continue;
    }

    if (!file.name.toLowerCase().endsWith('.pdf')) {
      results.push({ ok: false, filename: file.name, error: 'Podporován je pouze soubor .pdf', code: 'BAD_FORMAT' });
      continue;
    }

    try {
      const summary = await processFuelReceiptUpload({
        bytes: new Uint8Array(await file.arrayBuffer()),
        dryRun: parsedForm.data.dryRun,
      });

      results.push({ ok: true, filename: file.name, ...summary });
    } catch (error: unknown) {
      if (error instanceof FuelReceiptError) {
        results.push({ ok: false, filename: file.name, error: error.message, code: error.code });
        continue;
      }

      console.error('Fuel receipt ingest failed', file.name, error);
      results.push({ ok: false, filename: file.name, error: 'Nahrání účtenky se nezdařilo', code: 'INTERNAL' });
    }
  }

  return NextResponse.json({ results });
}
