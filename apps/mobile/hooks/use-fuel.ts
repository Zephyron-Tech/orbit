import { useQuery } from '@tanstack/react-query';

import { apiClient, UnauthorizedError } from '../lib/api-client';
import type { FuelResponse } from '../lib/response-types';

const FUEL_KEY = ['fuel'];

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

/** Read-only for this pass — the only mutations are the import uploads, already covered by use-import.ts. */
export function useFuel() {
  return useQuery({
    queryKey: FUEL_KEY,
    queryFn: () => apiClient.fuel.$get().then((response) => unwrap<FuelResponse>(response, 'Přehled paliva se nepodařilo načíst')),
  });
}
