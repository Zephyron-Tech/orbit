import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { TransactionCategory, TransactionRow, TransactionsListResponse } from '../lib/response-types';

export interface TransactionsListParams {
  period?: string;
  page?: number;
  accountId?: string;
  categoryId?: string;
  uncategorized?: boolean;
  shared?: boolean;
  q?: string;
  sort?: 'date' | 'amount';
  direction?: 'asc' | 'desc';
  transfer?: 'unmatched';
}

const TRANSACTIONS_KEY = 'transactions';

/**
 * A structural (not nominal) type for the bit of `Response` actually used
 * here. Hono's RPC client returns its own `ClientResponse<...>` type, which
 * is close to but not assignable to React Native's global `Response` (its
 * `FormData`/`Blob` shapes differ from the DOM lib's) — matching structurally
 * on just `ok`/`status`/`json()` sidesteps that mismatch entirely.
 */
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

export function useTransactionsList(params: TransactionsListParams) {
  return useQuery({
    queryKey: [TRANSACTIONS_KEY, 'list', params],
    queryFn: () =>
      apiClient.transactions
        .$get({
          query: {
            period: params.period ?? '',
            page: params.page ? String(params.page) : '',
            accountId: params.accountId ?? '',
            categoryId: params.categoryId ?? '',
            uncategorized: params.uncategorized ? '1' : '',
            shared: params.shared ? '1' : '',
            q: params.q ?? '',
            sort: params.sort ?? '',
            direction: params.direction ?? '',
            transfer: params.transfer ?? '',
          },
        })
        .then((response) => unwrap<TransactionsListResponse>(response, 'Nepodařilo se načíst transakce')),
  });
}

export function useTransaction(id: string) {
  return useQuery({
    queryKey: [TRANSACTIONS_KEY, 'detail', id],
    queryFn: () =>
      apiClient.transactions[':id']
        .$get({ param: { id } })
        .then((response) => unwrap<TransactionRow>(response, 'Transakce nenalezena')),
    enabled: id.length > 0,
  });
}

export interface UpdateTransactionInput {
  id: string;
  categoryId: string | null;
  bucketId: string | null;
  recurringExpenseId: string | null;
  kind: 'NORMAL' | 'INTERNAL_TRANSFER' | 'PENDING_TRANSFER' | 'SETTLEMENT';
  isShared: boolean;
  paidBy: 'ME' | 'PARTNER';
  myShareRatio: number | null;
  notes: string | null;
}

function invalidateTransactionQueries(queryClient: ReturnType<typeof useQueryClient>, id?: string): void {
  void queryClient.invalidateQueries({ queryKey: [TRANSACTIONS_KEY] });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  void queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  if (id) void queryClient.invalidateQueries({ queryKey: [TRANSACTIONS_KEY, 'detail', id] });
}

export function useUpdateTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: UpdateTransactionInput) =>
      apiClient.transactions.$patch({ json: input }).then((response) => unwrap<{ ok: true }>(response, 'Nepodařilo se uložit transakci')),
    onSuccess: (_data, variables) => invalidateTransactionQueries(queryClient, variables.id),
  });
}

export interface SplitLineInput {
  amount: string;
  categoryId: string | null;
  isShared: boolean;
  myShareRatio: number | null;
  notes: string | null;
}

/** Matches the API's `splitSchema` bound (`apps/api/src/routes/transactions.ts`). */
export const SPLIT_MIN_LINES = 2;
export const SPLIT_MAX_LINES = 20;

export function useSplitTransaction() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { parentId: string; lines: SplitLineInput[] }) =>
      apiClient.transactions.split.$post({ json: input }).then((response) => unwrap<{ ok: true }>(response, 'Rozdělení se nezdařilo')),
    onSuccess: (_data, variables) => invalidateTransactionQueries(queryClient, variables.parentId),
  });
}

export function useMergeSplit() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.transactions[':id']['merge-split']
        .$post({ param: { id } })
        .then((response) => unwrap<{ ok: true }>(response, 'Sloučení se nezdařilo')),
    onSuccess: (_data, id) => invalidateTransactionQueries(queryClient, id),
  });
}

export function useBulkCategorize() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { ids: string[]; categoryId: string | null }) =>
      apiClient.transactions['bulk-categorize']
        .$post({ json: input })
        .then((response) => unwrap<{ ok: true }>(response, 'Hromadné přiřazení kategorie se nezdařilo')),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useMatchTransfers() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () =>
      apiClient.transactions['match-transfers']
        .$post()
        .then((response) => unwrap<{ ok: true; matched: number; ambiguous: number }>(response, 'Spárování převodů se nezdařilo')),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

// Dismissing an unmatched transfer from the list screen uses the same
// endpoint apps/mobile/hooks/use-net-worth.ts's useDismissUnmatchedTransfer
// already wraps — reuse that hook directly instead of duplicating it here.

export function useCreateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { name: string; isShared: boolean }) =>
      apiClient.transactions.categories
        .$post({ json: input })
        .then((response) => unwrap<TransactionCategory>(response, 'Kategorii se nepodařilo vytvořit')),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export function useUpdateCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { id: string; name: string; isShared: boolean; isActive: boolean }) => {
      // apps/api validates this route's body with plain `c.req.json()`, not
      // `zValidator`, so the RPC client has no static schema for a `:param`
      // route's body — assigning through a named const first (rather than a
      // fresh object literal) sidesteps TypeScript's excess-property check
      // on the literal while the call still typechecks and sends the body
      // correctly at runtime (same workaround apps/web/lib/api-client.ts uses).
      const requestOptions = { param: { id: input.id }, json: { name: input.name, isShared: input.isShared, isActive: input.isActive } };
      return apiClient.transactions.categories[':id']
        .$patch(requestOptions)
        .then((response) => unwrap<TransactionCategory>(response, 'Kategorii se nepodařilo uložit'));
    },
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}

export interface MerchantRecommendationTarget {
  accountId: string;
  categoryId: string;
  merchantKey: string;
  from: string;
  to: string;
}

export function useApplyMerchantCategory() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: MerchantRecommendationTarget) =>
      apiClient.transactions['apply-merchant-category']
        .$post({ json: input })
        .then((response) => unwrap<{ ok: true; updated: number }>(response, 'Přiřazení kategorie se nezdařilo')),
    onSuccess: () => invalidateTransactionQueries(queryClient),
  });
}
