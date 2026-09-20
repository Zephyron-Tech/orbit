import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { SettingsResponse } from '../lib/response-types';

const SETTINGS_KEY = ['settings'];

interface JsonLikeResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

async function unwrapVoid(response: JsonLikeResponse, fallbackError: string): Promise<void> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallbackError);
  }
}

async function unwrap<T>(response: JsonLikeResponse, fallbackError: string): Promise<T> {
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? fallbackError);
  }
  return response.json() as Promise<T>;
}

export function useSettings() {
  return useQuery({
    queryKey: SETTINGS_KEY,
    queryFn: () => apiClient.settings.$get().then((response) => unwrap<SettingsResponse>(response, 'Nastavení se nepodařilo načíst')),
  });
}

export function useChangeEmail() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (email: string) => apiClient.settings.email.$patch({ json: { email } }).then((response) => unwrapVoid(response, 'E-mail se nepodařilo změnit')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['session'] }),
  });
}

export function useChangePassword() {
  return useMutation({
    mutationFn: (input: { currentPassword: string; newPassword: string }) =>
      apiClient.settings.password.$patch({ json: input }).then((response) => unwrapVoid(response, 'Heslo se nepodařilo změnit')),
  });
}

export function useUpdateReportingStartMonth() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (month: string | null) =>
      apiClient.settings['reporting-start-month'].$patch({ json: { month } }).then((response) => unwrapVoid(response, 'Nepodařilo se uložit počáteční měsíc')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: SETTINGS_KEY }),
  });
}
