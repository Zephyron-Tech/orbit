import { PDFParse } from 'pdf-parse';
import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { CsvStructureError } from '@/lib/parsers/csv/types';
import { parseGeneraliContract } from '@/lib/parsers/pdf/generali-contract';
import { parseGreenCard } from '@/lib/parsers/pdf/generali-green-card';
import { ensurePdfWorkerConfigured } from '@/lib/parsers/pdf/pdf-worker';

/**
 * Stateless — parses one insurance PDF and hands back whatever it could
 * extract, for a form to prefill. Never writes anything; a policy doesn't
 * need to exist yet to use this. Storing the document (once a policy id
 * exists) is a separate route: `/api/insurance/[policyId]/documents`.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const kindSchema = z.enum(['CONTRACT', 'GREEN_CARD']);

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  const formData = await request.formData().catch(() => null);

  if (!formData) {
    return NextResponse.json({ error: 'Očekáván multipart/form-data' }, { status: 400 });
  }

  const parsedKind = kindSchema.safeParse(formData.get('kind'));

  if (!parsedKind.success) {
    return NextResponse.json({ error: 'Chybí platný typ dokumentu' }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím PDF soubor' }, { status: 400 });
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

  ensurePdfWorkerConfigured();
  const pdf = new PDFParse({ data: Buffer.from(await file.arrayBuffer()) });

  try {
    const { text } = await pdf.getText();

    if (parsedKind.data === 'GREEN_CARD') {
      return NextResponse.json(parseGreenCard(text));
    }

    return NextResponse.json(parseGeneraliContract(text));
  } catch (error: unknown) {
    if (error instanceof CsvStructureError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('Insurance document parse failed', error);

    return NextResponse.json({ error: 'Nečitelný soubor PDF' }, { status: 400 });
  } finally {
    await pdf.destroy();
  }
}
