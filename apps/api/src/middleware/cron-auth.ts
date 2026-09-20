import { createMiddleware } from 'hono/factory';

import { isIngestionAuthorized } from '@orbit-api/lib/auth/ingestion-secret';
import { getEnv } from '@orbit-api/lib/validation/env';

/** Gate for `/cron/*` — same shared `INGESTION_SECRET` Vercel/docker-internal cron already uses. */
export const cronAuth = createMiddleware(async (c, next) => {
  if (!isIngestionAuthorized(c.req.raw, getEnv().INGESTION_SECRET)) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  await next();
});
