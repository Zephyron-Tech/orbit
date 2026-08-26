import { NextResponse } from 'next/server';

import { getActiveUser } from '@/lib/auth';
import { FuelReceiptError, processFuelReceiptUpload } from '@/lib/import/process-fuel-receipt';

// Prisma and the PDF parser need the Node.js runtime, and an upload must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A single-page receipt PDF is a few hundred KB at most. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: 'Očekáván multipart/form-data' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím účtenku ve formátu PDF' }, { status: 400 });
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
    const summary = await processFuelReceiptUpload(new Uint8Array(await file.arrayBuffer()));

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof FuelReceiptError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    console.error('Fuel receipt upload failed', error);

    return NextResponse.json({ error: 'Nahrání účtenky se nezdařilo' }, { status: 500 });
  }
}
