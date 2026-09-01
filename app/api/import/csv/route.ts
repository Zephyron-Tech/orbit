import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { ImportError, processCsvImport } from '@/lib/import/process-csv';

// Prisma and the parsers need the Node.js runtime, and an import must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** A month of statements is a few tens of kilobytes; this is a generous ceiling. */
const MAX_FILE_BYTES = 5 * 1024 * 1024;

const ACCEPTED_EXTENSIONS = ['.csv', '.xml', '.pdf'];

const formSchema = z.object({
  accountId: z.uuid(),
  dryRun: z
    .string()
    .optional()
    .transform((value) => value !== 'false'),
  /** Optional; a Czech-formatted amount is normalized to a decimal string. */
  closingBalance: z
    .string()
    .optional()
    .transform((value) => (value ?? '').trim())
    .refine(
      (value) => value === '' || /^-?[\d\s ]+([.,]\d{1,4})?$/.test(value),
      'Zadejte zůstatek jako číslo, např. 12345,67',
    )
    .transform((value) => (value === '' ? null : value.replace(/[\s ]/g, '').replace(',', '.'))),
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

  const parsedForm = formSchema.safeParse({
    accountId: formData.get('accountId'),
    dryRun: formData.get('dryRun') ?? undefined,
    closingBalance: formData.get('closingBalance') ?? undefined,
  });

  if (!parsedForm.success) {
    const issue = parsedForm.error.issues[0]?.message ?? 'Chybí platné ID účtu';

    return NextResponse.json({ error: issue }, { status: 400 });
  }

  const file = formData.get('file');

  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'Nahrajte prosím CSV, XML nebo PDF soubor' }, { status: 400 });
  }

  if (file.size === 0) {
    return NextResponse.json({ error: 'Soubor je prázdný' }, { status: 400 });
  }

  if (file.size > MAX_FILE_BYTES) {
    return NextResponse.json({ error: 'Soubor je větší než 5 MB' }, { status: 413 });
  }

  if (!ACCEPTED_EXTENSIONS.some((extension) => file.name.toLowerCase().endsWith(extension))) {
    return NextResponse.json({ error: 'Podporovány jsou soubory .csv, .xml a .pdf' }, { status: 415 });
  }

  try {
    const summary = await processCsvImport({
      bytes: new Uint8Array(await file.arrayBuffer()),
      filename: file.name,
      accountId: parsedForm.data.accountId,
      dryRun: parsedForm.data.dryRun,
      closingBalance: parsedForm.data.closingBalance,
    });

    return NextResponse.json(summary);
  } catch (error: unknown) {
    if (error instanceof ImportError) {
      const status = error.code === 'ALREADY_IMPORTED' ? 409 : 400;

      return NextResponse.json({ error: error.message, code: error.code }, { status });
    }

    // Never leak an internal error message to the client.
    console.error('CSV import failed', error);

    return NextResponse.json({ error: 'Import se nezdařil' }, { status: 500 });
  }
}
