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

export interface InvestmentPlanInput {
  name: string;
  sourceAccountId: string | null;
  brokerAccountId: string;
  expectedAmount: string;
  currency: string;
  dueDay: number;
  graceDays: number;
  isActive: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

export function useCreateInvestmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InvestmentPlanInput) =>
      apiClient.planning['investment-plans'].$post({ json: input }).then((response) => unwrapVoid(response, 'Plán se nepodařilo vytvořit')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useUpdateInvestmentPlan() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InvestmentPlanInput }) => {
      const requestOptions = { param: { id }, json: input };
      return apiClient.planning['investment-plans'][':id'].$patch(requestOptions).then((response) => unwrapVoid(response, 'Plán se nepodařilo uložit'));
    },
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

export interface IncomeSourceRuleInput {
  name: string;
  merchantText: string;
  accountId: string | null;
}

export function useCreateIncomeSourceRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: IncomeSourceRuleInput) =>
      apiClient.planning['income-source-rules'].$post({ json: input }).then((response) => unwrapVoid(response, 'Pravidlo se nepodařilo vytvořit')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useUpdateIncomeSourceRule() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: IncomeSourceRuleInput }) => {
      const requestOptions = { param: { id }, json: input };
      return apiClient.planning['income-source-rules'][':id'].$patch(requestOptions).then((response) => unwrapVoid(response, 'Pravidlo se nepodařilo uložit'));
    },
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

export interface RecurringExpenseInput {
  name: string;
  categoryId: string | null;
  expectedAmount: string;
  currency: string;
  isShared: boolean;
  myShareRatio: number | null;
  isActive: boolean;
  dueDay: number | null;
  graceDays: number;
  startsOn: string | null;
  endsOn: string | null;
  paymentAccountId: string | null;
}

export function useCreateRecurringExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: RecurringExpenseInput) =>
      apiClient.planning['recurring-expenses'].$post({ json: input }).then((response) => unwrapVoid(response, 'Fixní výdaj se nepodařilo vytvořit')),
    onSuccess: () => invalidatePlanning(queryClient),
  });
}

export function useUpdateRecurringExpense() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: RecurringExpenseInput }) => {
      const requestOptions = { param: { id }, json: input };
      return apiClient.planning['recurring-expenses'][':id'].$patch(requestOptions).then((response) => unwrapVoid(response, 'Fixní výdaj se nepodařilo uložit'));
    },
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
