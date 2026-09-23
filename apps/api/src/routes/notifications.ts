import { Hono } from 'hono';

import { prisma } from '@orbit-api/lib/db/prisma';
import type { AuthEnv } from '@orbit-api/middleware/auth';
import { requireAuth } from '@orbit-api/middleware/auth';

/** Newest-first history for the in-app notification center — every push this user was actually sent, read or not. */
const LIST_LIMIT = 100;

export const notifications = new Hono<AuthEnv>()
  .use('*', requireAuth)
  .get('/', async (c) => {
    const claims = c.get('user');
    const rows = await prisma.sentNotification.findMany({
      where: { userId: claims.sub },
      orderBy: { sentAt: 'desc' },
      take: LIST_LIMIT,
      select: { id: true, type: true, title: true, body: true, data: true, sentAt: true, readAt: true },
    });

    return c.json({
      notifications: rows.map((row) => ({
        id: row.id,
        type: row.type,
        title: row.title,
        body: row.body,
        data: row.data,
        sentAt: row.sentAt.toISOString(),
        readAt: row.readAt?.toISOString() ?? null,
      })),
      unreadCount: rows.filter((row) => !row.readAt).length,
    });
  })
  .patch('/read-all', async (c) => {
    const claims = c.get('user');
    const result = await prisma.sentNotification.updateMany({ where: { userId: claims.sub, readAt: null }, data: { readAt: new Date() } });
    return c.json({ ok: true, count: result.count });
  })
  .patch('/:id/read', async (c) => {
    const claims = c.get('user');
    const id = c.req.param('id');

    // Scoped to the caller's own userId so one user can never mark another's
    // notification read via a guessed id — same ownership guard every other
    // per-row mutation route in this API applies. `readAt: null` in the
    // where-clause makes this idempotent without needing a pre-read: a
    // second tap on an already-read row matches zero rows (not an error,
    // just nothing left to do) rather than re-stamping the timestamp.
    const owned = await prisma.sentNotification.findFirst({ where: { id, userId: claims.sub }, select: { id: true } });
    if (!owned) return c.json({ error: 'Oznámení nenalezeno' }, 404);

    await prisma.sentNotification.updateMany({ where: { id, userId: claims.sub, readAt: null }, data: { readAt: new Date() } });
    return c.json({ ok: true });
  });
