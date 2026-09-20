import { NextResponse } from 'next/server';
import { z } from 'zod';

import { MIN_PASSWORD_LENGTH, WeakPasswordError } from '@/lib/auth/password';
import { acceptInvite, InviteError } from '@/lib/auth/users';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  token: z.string().min(1),
  name: z.string().max(120).default(''),
  password: z.string().min(MIN_PASSWORD_LENGTH),
});

export async function POST(request: Request): Promise<NextResponse> {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));

  if (!parsed.success) {
    return NextResponse.json({ error: `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků` }, { status: 400 });
  }

  try {
    await acceptInvite(parsed.data);

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error: unknown) {
    if (error instanceof InviteError || error instanceof WeakPasswordError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    console.error('Invite acceptance failed', error);

    return NextResponse.json({ error: 'Registraci se nepodařilo dokončit' }, { status: 500 });
  }
}
