import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ policyId: string; documentId: string }> },
): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  const { policyId, documentId } = await params;
  const parsedPolicyId = z.uuid().safeParse(policyId);
  const parsedDocumentId = z.uuid().safeParse(documentId);

  if (!parsedPolicyId.success || !parsedDocumentId.success) {
    return NextResponse.json({ error: 'Neplatný dokument' }, { status: 400 });
  }

  const document = await prisma.insurancePolicyDocument.findUnique({
    where: { id: parsedDocumentId.data },
    select: { policyId: true, filename: true, contentType: true, bytes: true },
  });

  if (!document || document.policyId !== parsedPolicyId.data) {
    return NextResponse.json({ error: 'Dokument nenalezen' }, { status: 404 });
  }

  return new NextResponse(new Uint8Array(document.bytes), {
    headers: {
      'Content-Type': document.contentType,
      'Content-Disposition': `inline; filename="${document.filename.replace(/"/g, '')}"`,
    },
  });
}
