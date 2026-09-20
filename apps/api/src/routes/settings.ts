import { Hono } from 'hono';
import { z } from 'zod';

import { hashPassword, verifyPassword, WeakPasswordError } from '@orbit-api/lib/auth/password';
import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const emailSchema = z.email().transform((value) => value.trim().toLowerCase());
const passwordSchema = z.object({ currentPassword: z.string().min(1, 'Zadejte současné heslo'), newPassword: z.string().min(1, 'Zadejte nové heslo') });

/** Same shape as `lib/ui/period.ts`'s `isPeriod` on the web side — a pure "YYYY-MM" check, not worth a whole file for one regex. */
const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
function isPeriod(value: string | null | undefined): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

export const settings = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .patch('/email', async (c) => {
    const claims = c.get('user');
    const parsed = emailSchema.safeParse((await c.req.json())?.email);
    if (!parsed.success) return c.json({ error: 'Zadejte platný e-mail' }, 400);

    try {
      await prisma.user.update({ where: { id: claims.sub }, data: { email: parsed.data } });
    } catch (error: unknown) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        return c.json({ error: 'Tento e-mail už používá jiný účet' }, 409);
      }
      throw error;
    }

    return c.json({ ok: true });
  })
  .patch('/password', async (c) => {
    const claims = c.get('user');
    const parsed = passwordSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? 'Neplatný vstup' }, 400);

    const row = await prisma.user.findUnique({ where: { id: claims.sub }, select: { passwordHash: true } });
    if (!row || !(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
      return c.json({ error: 'Současné heslo není správné' }, 401);
    }

    let newHash: string;
    try {
      newHash = await hashPassword(parsed.data.newPassword);
    } catch (error: unknown) {
      if (error instanceof WeakPasswordError) return c.json({ error: 'Heslo musí mít alespoň 10 znaků' }, 400);
      throw error;
    }

    await prisma.user.update({ where: { id: claims.sub }, data: { passwordHash: newHash } });
    return c.json({ ok: true });
  })
  .patch('/reporting-start-month', async (c) => {
    const month = (await c.req.json())?.month as string | null;
    if (month !== null && !isPeriod(month)) return c.json({ error: 'Neplatný měsíc' }, 400);

    const reportingStartMonth = month ? new Date(`${month}-01T00:00:00.000Z`) : null;

    await prisma.planningSettings.upsert({
      where: { id: 'household' },
      create: { id: 'household', reportingStartMonth },
      update: { reportingStartMonth },
    });

    return c.json({ ok: true });
  });
