import { createHash } from 'node:crypto';

import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

/**
 * Stores a policy's contract or green-card PDF. Requires an existing policy
 * — a document is always attached to one, so this only makes sense once the
 * policy row exists (in edit mode, or right after a successful create).
 * History-capable: re-uploading a new green card at renewal adds a row, it
 * doesn't replace the old one.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MAX_FILE_BYTES = 5 * 1024 * 1024;

const kindSchema = z.enum(['CONTRACT', 'GREEN_CARD']);

export async function POST(request: Request, { params }: { params: Promise<{ policyId: string }> }): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  const parsedPolicyId = z.uuid().safeParse((await params).policyId);

  if (!parsedPolicyId.success) {
    return NextResponse.json({ error: 'Neplatná pojistka' }, { status: 400 });
  }

  const policy = await prisma.insurancePolicy.findUnique({ where: { id: parsedPolicyId.data }, select: { id: true } });

  if (!policy) {
    return NextResponse.json({ error: 'Pojistka nenalezena' }, { status: 404 });
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

  const bytes = Buffer.from(await file.arrayBuffer());
  const sourceFileHash = createHash('sha256').update(bytes).digest('hex');

  try {
    const document = await prisma.insurancePolicyDocument.create({
      data: {
        policyId: policy.id,
        kind: parsedKind.data,
        filename: file.name,
        contentType: 'application/pdf',
        bytes,
        sourceFileHash,
      },
      select: { id: true, kind: true, filename: true, uploadedAt: true },
    });

    return NextResponse.json(document);
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return NextResponse.json({ error: 'Tento soubor už je nahraný' }, { status: 409 });
    }

    throw error;
  }
}
