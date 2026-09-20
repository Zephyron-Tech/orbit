import { QueryClient } from '@tanstack/react-query';

/**
 * `authorizedFetch` (see `lib/api-client.ts`) already retries a 401 once
 * with a refreshed token before giving up — a 401 that reaches a query's
 * `onError` means the session is genuinely gone (refresh also failed), so
 * retrying it again from TanStack Query would just hammer a dead session.
 * Any other failure (network blip, 5xx) still gets the default retry.
 */
function shouldRetry(failureCount: number, error: unknown): boolean {
  if (error instanceof Error && error.message === 'UNAUTHORIZED') return false;
  return failureCount < 2;
}

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: shouldRetry,
      staleTime: 30_000,
    },
    mutations: {
      retry: false,
    },
  },
});
