/**
 * Shared bearer-secret check for machine-to-machine routes that have no
 * session (cron triggers, provider webhooks, automation bots). Used by
 * routes exempted from session auth in `proxy.ts`'s `PUBLIC_PREFIXES`.
 */

/** Constant-time comparison, so the shared secret cannot be timed out of the server. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return mismatch === 0;
}

/** Checks the `Authorization: Bearer <secret>` header against the expected secret. */
export function isIngestionAuthorized(request: Request, expectedSecret: string): boolean {
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;

  return secretMatches(provided, expectedSecret);
}
