import { Hono } from 'hono';
import { z } from 'zod';

import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth, requireRole } from '@orbit-api/middleware/auth';

class UserManagementError extends Error {}

const userSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().max(120).nullable().transform((value) => value || null),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: z.enum(['OWNER', 'MEMBER']),
  isActive: z.boolean(),
});

export const users = new Hono<AuthEnv>()
  .use('*', requireAuth, requireRole('OWNER'))
  .patch('/:id', async (c) => {
    // requireRole trusts the JWT claim; re-verified against the DB here too,
    // same as the original action's `activeOwner()` — a token can outlive a
    // just-revoked OWNER for up to its 15-minute lifetime otherwise.
    const claims = c.get('user');
    const actor = await prisma.user.findFirst({ where: { id: claims.sub, role: 'OWNER', isActive: true }, select: { id: true } });
    if (!actor) return c.json({ error: 'Správu členů může měnit pouze aktivní vlastník.' }, 403);

    const parsed = userSchema.safeParse({ ...(await c.req.json()), id: c.req.param('id') });
    if (!parsed.success) return c.json({ error: 'Zkontrolujte jméno, e-mail a zvolenou roli.' }, 400);

    try {
      await prisma.$transaction(async (tx) => {
        // $executeRaw, not $queryRaw: pg_advisory_xact_lock returns void, and
        // the pg driver adapter cannot deserialize a void column back through
        // $queryRaw (Prisma 7 + @prisma/adapter-pg — P2010/UnsupportedNativeDataType).
        // The lock is taken purely for its side effect; no result is read.
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(742021)`;
        const target = await tx.user.findUnique({ where: { id: parsed.data.id } });
        if (!target) throw new UserManagementError('Uživatel už neexistuje.');
        if (target.id === actor.id && (parsed.data.role !== 'OWNER' || !parsed.data.isActive)) {
          throw new UserManagementError('Vlastní účet nelze deaktivovat ani převést na člena.');
        }
        const removesActiveOwner = target.role === 'OWNER' && target.isActive && (parsed.data.role !== 'OWNER' || !parsed.data.isActive);
        if (removesActiveOwner) {
          const ownerCount = await tx.user.count({ where: { role: 'OWNER', isActive: true } });
          if (ownerCount <= 1) throw new UserManagementError('Domácnost musí mít alespoň jednoho aktivního vlastníka.');
        }
        await tx.user.update({
          where: { id: target.id },
          data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, isActive: parsed.data.isActive },
        });
      });
    } catch (error: unknown) {
      if (error instanceof UserManagementError) return c.json({ error: error.message }, 409);
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json({ error: 'Tento e-mail už používá jiný účet.' }, 409);
      }
      console.error('Household user update failed', error);
      return c.json({ error: 'Účet se nepodařilo uložit.' }, 500);
    }

    return c.json({ ok: true });
  })
  .delete('/invites/:id', async (c) => {
    const parsedId = z.uuid().safeParse(c.req.param('id'));
    if (!parsedId.success) return c.json({ error: 'Neplatná pozvánka.' }, 400);

    await prisma.invite.deleteMany({ where: { id: parsedId.data, acceptedAt: null } });
    return c.json({ ok: true });
  });
