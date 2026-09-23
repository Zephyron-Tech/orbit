import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { NotificationsResponse } from '../lib/response-types';

const NOTIFICATIONS_KEY = ['notifications'];

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

export function useNotifications() {
  return useQuery({
    queryKey: NOTIFICATIONS_KEY,
    queryFn: () => apiClient.notifications.$get().then((response) => unwrap<NotificationsResponse>(response, 'Oznámení se nepodařilo načíst')),
  });
}

export function useMarkNotificationRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) => apiClient.notifications[':id'].read.$patch({ param: { id } }).then((response) => unwrap<{ ok: true }>(response, 'Nepodařilo se označit jako přečtené')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useMarkAllNotificationsRead() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.notifications['read-all'].$patch().then((response) => unwrap<{ ok: true; count: number }>(response, 'Nepodařilo se označit oznámení jako přečtená')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}

export function useDeleteAllNotifications() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.notifications.$delete().then((response) => unwrap<{ ok: true; count: number }>(response, 'Nepodařilo se smazat oznámení')),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: NOTIFICATIONS_KEY }),
  });
}
