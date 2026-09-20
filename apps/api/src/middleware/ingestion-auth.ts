import { createMiddleware } from 'hono/factory';

import { isIngestionAuthorized } from '@orbit-api/lib/auth/ingestion-secret';

/**
 * Per-bot secret gate for the `/ingest/*` M2M routes. Takes the *name* of the
 * env var to check, not the value, so each ingest route keeps its own secret
 * isolated — a leaked bot secret must only ever unlock the one bot it belongs
 * to (see lib/validation/env.ts's per-secret comments).
 */
export function ingestionAuth(envVarName: string) {
  return createMiddleware(async (c, next) => {
    const expected = process.env[envVarName];

    if (!expected || !isIngestionAuthorized(c.req.raw, expected)) {
      return c.json({ error: 'Unauthorized' }, 401);
    }

    await next();
  });
}
