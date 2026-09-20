import { Hono } from 'hono';
import { z } from 'zod';

import { MIN_PASSWORD_LENGTH, WeakPasswordError } from '@orbit-api/lib/auth/password';
import { acceptInvite, createInvite, InviteError } from '@orbit-api/lib/auth/users';
import { prisma } from '@orbit-api/lib/db/prisma';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth, requireRole } from '@orbit-api/middleware/auth';

/**
 * The API listens behind Traefik/a container network, so `c.req.url` would
 * put an internal hostname into the invitation link. Trust the forwarded
 * headers instead, same as the original Next.js route.
 */
function resolveOrigin(c: import('hono').Context): string {
  const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
  if (!host) return new URL(c.req.url).origin;
  const protocol = c.req.header('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  return `${protocol}://${host}`;
}

const createSchema = z.object({ email: z.email(), role: z.enum(['OWNER', 'MEMBER']).default('MEMBER') });
const acceptSchema = z.object({ token: z.string().min(1), name: z.string().max(120).default(''), password: z.string().min(MIN_PASSWORD_LENGTH) });

export const invites = new Hono<AuthEnv>()
  .post('/', requireAuth, requireRole('OWNER'), async (c) => {
    const claims = c.get('user');
    const parsed = createSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: 'Zadejte platný e-mail' }, 400);

    try {
      const invite = await createInvite({ email: parsed.data.email, role: parsed.data.role, createdById: claims.sub, origin: resolveOrigin(c) });
      return c.json(invite, 201);
    } catch (error: unknown) {
      if (error instanceof InviteError) return c.json({ error: error.message, code: error.code }, 409);
      console.error('Invite creation failed', error);
      return c.json({ error: 'Pozvánku se nepodařilo vytvořit' }, 500);
    }
  })
  .get('/', requireAuth, requireRole('OWNER'), async (c) => {
    const inviteRows = await prisma.invite.findMany({
      orderBy: { createdAt: 'desc' },
      select: { id: true, email: true, role: true, expiresAt: true, acceptedAt: true, createdAt: true },
    });
    // Token hashes are deliberately not selected: nothing here can be replayed.
    return c.json({ invites: inviteRows });
  })
  // Public by design — this is how a person gets an account in the first
  // place, gated by the (single-use) token itself rather than a session.
  .post('/accept', async (c) => {
    const parsed = acceptSchema.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: `Heslo musí mít alespoň ${MIN_PASSWORD_LENGTH} znaků` }, 400);

    try {
      await acceptInvite(parsed.data);
      return c.json({ ok: true }, 201);
    } catch (error: unknown) {
      if (error instanceof InviteError || error instanceof WeakPasswordError) return c.json({ error: error.message }, 400);
      console.error('Invite acceptance failed', error);
      return c.json({ error: 'Registraci se nepodařilo dokončit' }, 500);
    }
  });
