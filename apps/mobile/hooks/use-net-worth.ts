import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { NetWorthResponse } from '../lib/response-types';

const NET_WORTH_KEY = ['net-worth'];

export function useNetWorth() {
  return useQuery({
    queryKey: NET_WORTH_KEY,
    queryFn: async (): Promise<NetWorthResponse> => {
      const response = await apiClient['net-worth'].$get();
      if (response.status === 401) throw new UnauthorizedError();
      if (!response.ok) throw new Error('Net worth request failed');
      return response.json() as Promise<NetWorthResponse>;
    },
  });
}

export function useDismissUnmatchedTransfer() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await apiClient.transactions[':id']['dismiss-unmatched-transfer'].$post({ param: { id } });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Nepodařilo se skrýt převod');
      }
      return response.json();
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: NET_WORTH_KEY });
      void queryClient.invalidateQueries({ queryKey: ['transactions'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });
}
