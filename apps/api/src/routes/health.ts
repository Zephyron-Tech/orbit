import { Hono } from 'hono';

import { prisma } from '@orbit-api/lib/db/prisma';

export const health = new Hono().get('/', async (c) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return c.json({ status: 'ok', database: 'up' });
  } catch (error: unknown) {
    console.error('Health check DB probe failed', error);
    return c.json({ status: 'error', database: 'down' }, 503);
  }
});
