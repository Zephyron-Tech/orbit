import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { FuelImportError, processFuelXlsImport } from '@/lib/import/process-fuel-xls';

// Prisma and the xls parser need the Node.js runtime, and an import must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A full multi-year Sales.xls export is still only tens of KB. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const formSchema = z.object({
  dryRun: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
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
    return NextResponse.json({ error: 'Nahrajte prosím soubor Sales.xls' }, { status: 400 });
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
    const summary = await processFuelXlsImport({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      dryRun: parsedForm.data.dryRun,
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof FuelImportError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Fuel xls import failed', error);

    return NextResponse.json({ error: 'Import se nezdařil' }, { status: 500 });
  }
}
