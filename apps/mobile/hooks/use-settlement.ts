import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { SettlementResponse } from '../lib/response-types';

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

function settlementKey(year: number, month: number): unknown[] {
  return ['settlement', year, month];
}

export function useSettlement(year: number, month: number) {
  return useQuery({
    queryKey: settlementKey(year, month),
    queryFn: () =>
      apiClient.settlement.$get({ query: { year: String(year), month: String(month) } }).then((response) => unwrap<SettlementResponse>(response, 'Vyrovnání se nepodařilo načíst')),
  });
}

function invalidateSettlement(queryClient: ReturnType<typeof useQueryClient>, year: number, month: number): void {
  void queryClient.invalidateQueries({ queryKey: settlementKey(year, month) });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

export function useCloseSettlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ year, month, notes }: { year: number; month: number; notes: string | null }) =>
      apiClient.settlement.close.$post({ json: { year, month, notes } }).then((response) => unwrap<{ ok: true }>(response, 'Vyrovnání se nepodařilo uzavřít')),
    onSuccess: (_result, variables) => invalidateSettlement(queryClient, variables.year, variables.month),
  });
}

export function useReopenSettlement() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id }: { id: string; year: number; month: number }) =>
      apiClient.settlement[':id'].reopen.$post({ param: { id } }).then((response) => unwrap<{ ok: true }>(response, 'Vyrovnání se nepodařilo znovu otevřít')),
    onSuccess: (_result, variables) => invalidateSettlement(queryClient, variables.year, variables.month),
  });
}

export function useMarkSettled() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, settled }: { id: string; settled: boolean; year: number; month: number }) => {
      const requestOptions = { param: { id }, json: { settled } };
      return apiClient.settlement[':id'].settled.$post(requestOptions).then((response) => unwrap<unknown>(response, 'Nepodařilo se změnit stav vyrovnání'));
    },
    onSuccess: (_result, variables) => invalidateSettlement(queryClient, variables.year, variables.month),
  });
}
