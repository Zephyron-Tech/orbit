import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { PortfolioResponse } from '../lib/response-types';

const PORTFOLIO_KEY = ['portfolio'];

interface JsonLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

async function unwrap<T>(response: JsonLikeResponse, fallbackError: string): Promise<T> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallbackError);
  }
  return response.json() as Promise<T>;
}

export function usePortfolio() {
  return useQuery({
    queryKey: PORTFOLIO_KEY,
    queryFn: () => apiClient.portfolio.$get().then((response) => unwrap<PortfolioResponse>(response, 'Portfolio se nepodařilo načíst')),
  });
}

export function useRefreshPortfolio() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.portfolio.refresh.$post().then((response) => unwrap<{ ok: true; capturedAt: string }>(response, 'Synchronizace selhala')),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: PORTFOLIO_KEY });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      void queryClient.invalidateQueries({ queryKey: ['net-worth'] });
    },
  });
}
