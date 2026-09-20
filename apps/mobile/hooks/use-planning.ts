import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { PlanningResponse } from '../lib/response-types';

const PLANNING_KEY = ['planning'];

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

async function unwrapVoid(response: JsonLikeResponse, fallbackError: string): Promise<void> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallbackError);
  }
}

export function usePlanning() {
  return useQuery({
    queryKey: PLANNING_KEY,
    queryFn: () => apiClient.planning.$get().then((response) => unwrap<PlanningResponse>(response, 'Nepodařilo se načíst plánování')),
  });
}

function invalidatePlanning(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: PLANNING_KEY });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
}

export interface SpendingTargetInput {
  monthlySpendingTarget: string | null;
  transferHistoryFrom: string | null;
  hideHistoricalBrokerTransfers: boolean;
}

export function useSaveSpendingTarget() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: SpendingTargetInput) =>
      apiClient.planning['spending-target'].$post({ json: input }).then((response) => unwrapVoid(response, 'Nepodařilo se uložit cíl výdajů')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useSetInvestmentPlanActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => {
      const requestOptions = { param: { id }, json: { isActive } };
      return apiClient.planning['investment-plans'][':id'].active
        .$post(requestOptions)
        .then((response) => unwrapVoid(response, 'Nepodařilo se změnit plán'));
    },
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useDeleteInvestmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.planning['investment-plans'][':id'].$delete({ param: { id } }).then((response) => unwrapVoid(response, 'Plán se nepodařilo smazat')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useSetIncomeSourceRuleActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => {
      const requestOptions = { param: { id }, json: { isActive } };
      return apiClient.planning['income-source-rules'][':id'].active
        .$post(requestOptions)
        .then((response) => unwrapVoid(response, 'Nepodařilo se změnit pravidlo'));
    },
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useDeleteIncomeSourceRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.planning['income-source-rules'][':id']
        .$delete({ param: { id } })
        .then((response) => unwrapVoid(response, 'Pravidlo se nepodařilo smazat')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useSetRecurringExpenseActive() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isActive }: { id: string; isActive: boolean }) => {
      const requestOptions = { param: { id }, json: { isActive } };
      return apiClient.planning['recurring-expenses'][':id'].active
        .$post(requestOptions)
        .then((response) => unwrapVoid(response, 'Nepodařilo se změnit fixní výdaj'));
    },
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useDeleteRecurringExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.planning['recurring-expenses'][':id']
        .$delete({ param: { id } })
        .then((response) => unwrapVoid(response, 'Fixní výdaj se nepodařilo smazat')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}
