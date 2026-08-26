import { NextResponse } from 'next/server';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { createInvite, InviteError } from '@/lib/auth/users';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * The container listens on 0.0.0.0, so `request.url` would put that into the
 * invitation link. Trust the Host header (and a proxy's forwarded protocol)
 * instead, which is what the browser actually used.
 */
function resolveOrigin(request: Request): string {
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');

  if (!host) {
    return new URL(request.url).origin;
  }

  const protocol =
    request.headers.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');

  return `${protocol}://${host}`;
}

const bodySchema = z.object({
  email: z.email(),
  role: z.enum(['OWNER', 'MEMBER']).default('MEMBER'),
});

export async function POST(request: Request): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  // Only an owner may widen access to the household's finances.
  if (user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Pozvánky může vytvářet jen vlastník' }, { status: 403 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: 'Zadejte platný e-mail' }, { status: 400 });
  }

  try {
    const invite = await createInvite({
      email: parsed.data.email,
      role: parsed.data.role,
      createdById: user.id,
      origin: resolveOrigin(request),
    });

    return NextResponse.json(invite, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof InviteError) {
      return NextResponse.json({ error: error.message, code: error.code }, { status: 409 });
    }

    console.error('Invite creation failed', error);

    return NextResponse.json({ error: 'Pozvánku se nepodařilo vytvořit' }, { status: 500 });
  }
}

export async function GET(): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user || user.role !== 'OWNER') {
    return NextResponse.json({ error: 'Nedostatečná oprávnění' }, { status: 403 });
  }

  const invites = await prisma.invite.findMany({
    orderBy: { createdAt: 'desc' },
    select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, createdAt: true },
  });

  // Token hashes are deliberately not selected: nothing here can be replayed.
  return NextResponse.json({ invites });
}
