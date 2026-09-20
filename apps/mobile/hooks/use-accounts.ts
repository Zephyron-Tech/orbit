import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { AccountInput, AccountRow } from '../lib/response-types';

const ACCOUNTS_KEY = ['accounts'];

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

/** For a 204 No Content response — parsing an empty body as JSON would throw. */
async function unwrapVoid(response: JsonLikeResponse, fallbackError: string): Promise<void> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallbackError);
  }
}

export function useAccountsList() {
  return useQuery({
    queryKey: ACCOUNTS_KEY,
    queryFn: () => apiClient.accounts.$get().then((response) => unwrap<AccountRow[]>(response, 'Nepodařilo se načíst účty')),
  });
}

function invalidateAccountQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: ACCOUNTS_KEY });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  void queryClient.invalidateQueries({ queryKey: ['net-worth'] });
}

export function useCreateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: AccountInput) =>
      apiClient.accounts.$post({ json: input }).then((response) => unwrap<AccountRow>(response, 'Účet se nepodařilo vytvořit')),
    onSuccess: () => invalidateAccountQueries(queryClient),
  });
}

export function useUpdateAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: AccountInput }) => {
      // The `:id` route's body has no static schema (apps/api validates it
      // with a plain `c.req.json()`, not `zValidator`), so the RPC client's
      // inferred input type for it is just `{ param }` — assigning through a
      // named const first sidesteps TypeScript's excess-property check on a
      // fresh object literal while the call still sends `json` at runtime.
      const requestOptions = { param: { id }, json: input };
      return apiClient.accounts[':id'].$patch(requestOptions).then((response) => unwrap<AccountRow>(response, 'Účet se nepodařilo uložit'));
    },
    onSuccess: () => invalidateAccountQueries(queryClient),
  });
}

export function useSetAccountArchived() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, isArchived }: { id: string; isArchived: boolean }) => {
      const requestOptions = { param: { id }, json: { isArchived } };
      return apiClient.accounts[':id'].archive.$post(requestOptions).then((response) => unwrap<AccountRow>(response, 'Účet se nepodařilo archivovat'));
    },
    onSuccess: () => invalidateAccountQueries(queryClient),
  });
}

export function useDeleteAccount() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.accounts[':id'].$delete({ param: { id } }).then((response) => unwrapVoid(response, 'Účet se nepodařilo smazat')),
    onSuccess: () => invalidateAccountQueries(queryClient),
  });
}
