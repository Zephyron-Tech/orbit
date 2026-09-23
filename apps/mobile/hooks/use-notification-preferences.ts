import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { NotificationPreferences } from '../lib/response-types';

const NOTIFICATION_PREFERENCES_KEY = ['notification-preferences'];

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

export function useNotificationPreferences() {
  return useQuery({
    queryKey: NOTIFICATION_PREFERENCES_KEY,
    queryFn: () =>
      apiClient.settings['notification-preferences'].$get().then((response) => unwrap<NotificationPreferences>(response, 'Nastavení notifikací se nepodařilo načíst')),
  });
}

export function useUpdateNotificationPreferences() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (partial: Partial<NotificationPreferences>) =>
      apiClient.settings['notification-preferences'].$patch({ json: partial }).then((response) => unwrap<NotificationPreferences>(response, 'Nepodařilo se uložit nastavení notifikací')),
    onSuccess: (data) => queryClient.setQueryData(NOTIFICATION_PREFERENCES_KEY, data),
  });
}
