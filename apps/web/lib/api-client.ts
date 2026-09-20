import { hc } from 'hono/client';
import type { AppType } from '@orbit/api-types';

/**
 * Hono RPC client for the new `apps/api` service. Phase 1 of the monorepo
 * migration (see the plan file) — only `/auth` and `/accounts` exist so far,
 * everything else still reads Prisma directly from this app until Phase 2
 * ports the remaining routers.
 *
 * `cookieHeader` is only needed server-side (Server Components don't
 * automatically forward the incoming request's cookies to an outgoing
 * fetch); a browser-side call sends its own cookies automatically via
 * `credentials: 'include'`.
 */
export function apiClient(cookieHeader?: string) {
  const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

  return hc<AppType>(apiUrl, {
    init: {
      credentials: 'include',
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    },
  });
}

export interface ApiActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Client-side proof of the RPC pattern (Phase 1's accounts-list slice):
 * reorder now goes through the Hono API's `lib/db/reorder.ts` SERIALIZABLE
 * helper instead of the Next.js server action's copy of the same logic.
 * Every other accounts mutation (create/update/delete/credit flows) stays on
 * the existing server actions until Phase 2 ports the rest of this router.
 */
export async function reorderAccountViaApi(id: string, direction: -1 | 1): Promise<ApiActionResult> {
  try {
    const response = await apiClient().accounts.reorder.$post({ json: { id, direction } });
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? 'Pořadí se nepodařilo změnit' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Pořadí se nepodařilo změnit' };
  }
}
