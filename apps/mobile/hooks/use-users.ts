import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { CreatedInvite, HouseholdUserRow, InvitesListResponse, UsersResponse } from '../lib/response-types';

const USERS_KEY = ['users'];
const INVITES_KEY = ['invites'];

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

export function useUsers() {
  return useQuery({
    queryKey: USERS_KEY,
    queryFn: () => apiClient.users.$get().then((response) => unwrap<UsersResponse>(response, 'Členy domácnosti se nepodařilo načíst')),
  });
}

export function useUpdateHouseholdUser() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: Pick<HouseholdUserRow, 'id' | 'name' | 'email' | 'role' | 'isActive'>) => {
      const requestOptions = { param: { id: input.id }, json: input };
      return apiClient.users[':id'].$patch(requestOptions).then((response) => unwrapVoid(response, 'Účet se nepodařilo uložit'));
    },
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: USERS_KEY }),
  });
}

export function useInvitesList(enabled: boolean) {
  return useQuery({
    queryKey: INVITES_KEY,
    enabled,
    queryFn: () => apiClient.invites.$get().then((response) => unwrap<InvitesListResponse>(response, 'Pozvánky se nepodařilo načíst')),
  });
}

export function useCreateInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: { email: string; role: 'OWNER' | 'MEMBER' }) =>
      apiClient.invites.$post({ json: input }).then((response) => unwrap<CreatedInvite>(response, 'Pozvánku se nepodařilo vytvořit')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}

export function useRevokeInvite() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.users.invites[':id'].$delete({ param: { id } }).then((response) => unwrapVoid(response, 'Pozvánku se nepodařilo zrušit')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: INVITES_KEY }),
  });
}
