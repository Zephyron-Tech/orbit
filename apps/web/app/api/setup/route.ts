import { NextResponse } from 'next/server';
import { z } from 'zod';

import { hashPassword, MIN_PASSWORD_LENGTH, WeakPasswordError } from '@/lib/auth/password';
import { needsFirstUser } from '@/lib/auth/users';
import { prisma } from '@/lib/db/prisma';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  email: z.email(),
  name: z.string().max(120).default(''),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

/**
 * Creates the first owner account. Only reachable while the user table is
 * empty: once anybody exists, further accounts come from invitations.
 */
export async function POST(request: Request): Promise<NextResponse> {
  if (!(await needsFirstUser())) {
    return NextResponse.json({ error: 'Orbit už má vlastníka, použijte pozvánku' }, { status: 409 });
  }

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků` }, { status: 400 });
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);

    // createMany with a count check closes the race between two setup requests.
    const created = await prisma.user.createMany({
      skipDuplicates: true,
      data: [
        {
          email: parsed.data.email.trim().toLowerCase(),
          name: parsed.data.name.trim() || null,
          passwordHash,
          role: 'OWNER',
        },
      ],
    });

    if (created.count === 0) {
      return NextResponse.json({ error: 'Účet už existuje' }, { status: 409 });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof WeakPasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('First user setup failed', error);

    return NextResponse.json({ error: 'Účet se nepodařilo vytvořit' }, { status: 500 });
  }
}
