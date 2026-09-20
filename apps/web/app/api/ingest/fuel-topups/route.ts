import { NextResponse } from 'next/server';
import { z } from 'zod';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { FuelTopUpImportError, processFuelTopUpsImport } from '@/lib/import/process-fuel-topups';
import { getEnv } from '@/lib/validation/env';

/**
 * Machine-to-machine counterpart of `app/api/import/fuel-topups/route.ts` —
 * same validation and the same `processFuelTopUpsImport` underneath, but
 * authorized by `FUEL_INGESTION_SECRET` (bearer token) instead of a browser
 * session, for the Tankarta automation bot running on its own machine.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A full multi-year ChargingPrepaids.xls export is still only tens of KB. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const formSchema = z.object({
  dryRun: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
});

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

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím soubor ChargingPrepaids.xls' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Soubor je prázdný' }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Soubor je větší než 5 MB' }, { status: 413 });
  }

  if (!file.name.toLowerCase().endsWith('.xls')) {
    return NextResponse.json({ error: 'Podporován je pouze soubor .xls' }, { status: 415 });
  }

  try {
    const summary = await processFuelTopUpsImport({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      dryRun: parsedForm.data.dryRun,
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof FuelTopUpImportError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Fuel top-up ingest failed', error);

    return NextResponse.json({ error: 'Import se nezdařil' }, { status: 500 });
  }
}
