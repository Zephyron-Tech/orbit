import { Hono } from 'hono';
import { z } from 'zod';

import { hashPassword, verifyPassword, WeakPasswordError } from '@orbit-api/lib/auth/password';
import { prisma } from '@orbit-api/lib/db/prisma';
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { NotificationPreferencesPatchSchema, NotificationPreferencesSchema, parseNotificationPreferences } from '@orbit-api/lib/notifications/preferences';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

const emailSchema = z.email().transform((value) => value.trim().toLowerCase());
const passwordSchema = z.object({ currentPassword: z.string().min(1, 'Zadejte současné heslo'), newPassword: z.string().min(1, 'Zadejte nové heslo') });
/** `token: null` clears the stored token (e.g. on logout) — the mobile client sends that explicitly rather than this endpoint ever guessing intent from an absent field. */
const pushTokenSchema = z.object({ token: z.string().min(1).nullable() });

/** Same shape as `lib/ui/period.ts`'s `isPeriod` on the web side — a pure "YYYY-MM" check, not worth a whole file for one regex. */
const PERIOD_PATTERN = /^(\d{4})-(0[1-9]|1[0-2])$/;
function isPeriod(value: string | null | undefined): value is string {
  return typeof value === 'string' && PERIOD_PATTERN.test(value);
}

/** Every calendar month from the earliest transaction through the current one, newest first. */
function monthsSince(earliestDate: Date | null): string[] {
  const now = new Date();
  const start = earliestDate ?? now;
  const startKey = start.getUTCFullYear() * 12 + start.getUTCMonth();
  const nowKey = now.getUTCFullYear() * 12 + now.getUTCMonth();
  const months: string[] = [];

  for (let key = nowKey; key >= startKey; key -= 1) {
    const year = Math.floor(key / 12);
    const month = key % 12;
    months.push(`${year}-${String(month + 1).padStart(2, '0')}`);
  }

  return months;
}

export const settings = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const [settingsRow, earliest] = await Promise.all([
      prisma.planningSettings.findUnique({ where: { id: 'household' } }),
      prisma.transaction.aggregate({ _min: { date: true } }),
    ]);

    return c.json({
      reportingStartMonth: settingsRow?.reportingStartMonth?.toISOString().slice(0, 7) ?? null,
      availableMonths: monthsSince(earliest._min.date),
    });
  })
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
  .patch('/push-token', async (c) => {
    const claims = c.get('user');
    const parsed = pushTokenSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatný token' }, 400);

    await prisma.user.update({ where: { id: claims.sub }, data: { expoPushToken: parsed.data.token } });
    return c.json({ ok: true });
  })
  .get('/notification-preferences', async (c) => {
    const claims = c.get('user');
    const row = await prisma.user.findUnique({ where: { id: claims.sub }, select: { notificationPreferences: true } });
    return c.json(parseNotificationPreferences(row?.notificationPreferences));
  })
  .patch('/notification-preferences', async (c) => {
    const claims = c.get('user');
    const parsed = NotificationPreferencesPatchSchema.safeParse(await c.req.json());
    if (!parsed.success) return c.json({ error: 'Neplatné nastavení notifikací' }, 400);

    const row = await prisma.user.findUnique({ where: { id: claims.sub }, select: { notificationPreferences: true } });
    const current = parseNotificationPreferences(row?.notificationPreferences);
    const merged = NotificationPreferencesSchema.parse({ ...current, ...parsed.data });

    await prisma.user.update({ where: { id: claims.sub }, data: { notificationPreferences: merged } });
    return c.json(merged);
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
