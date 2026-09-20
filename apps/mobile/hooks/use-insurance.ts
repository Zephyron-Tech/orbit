import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { API_URL, apiClient, UnauthorizedError } from '../lib/api-client';
import { getAccessToken } from '../lib/auth-storage';
import type { InsuranceListResponse, InsurancePolicyInput } from '../lib/response-types';

const INSURANCE_KEY = ['insurance'];

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

export function useInsuranceList() {
  return useQuery({
    queryKey: INSURANCE_KEY,
    queryFn: () => apiClient.insurance.$get().then((response) => unwrap<InsuranceListResponse>(response, 'Nepodařilo se načíst pojistky')),
  });
}

function invalidateInsuranceQueries(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: INSURANCE_KEY });
}

export function useCreatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (input: InsurancePolicyInput) =>
      apiClient.insurance.$post({ json: input }).then((response) => unwrap<{ id: string }>(response, 'Pojistku se nepodařilo vytvořit')),
    onSuccess: () => invalidateInsuranceQueries(queryClient),
  });
}

export function useUpdatePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, input }: { id: string; input: InsurancePolicyInput }) => {
      // See use-accounts.ts's useUpdateAccount for why the request body is
      // assigned to a named const first — same untyped-`:id`-route quirk.
      const requestOptions = { param: { id }, json: input };
      return apiClient.insurance[':id'].$patch(requestOptions).then((response) => unwrap<{ id: string }>(response, 'Pojistku se nepodařilo uložit'));
    },
    onSuccess: () => invalidateInsuranceQueries(queryClient),
  });
}

export function useDeletePolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (id: string) =>
      apiClient.insurance[':id'].$delete({ param: { id } }).then((response) => unwrapVoid(response, 'Pojistku se nepodařilo smazat')),
    onSuccess: () => invalidateInsuranceQueries(queryClient),
  });
}

export type InsuranceDocumentKind = 'CONTRACT' | 'GREEN_CARD';

/**
 * Document upload takes `multipart/form-data`, which the typed Hono RPC
 * client isn't built to express — a plain `fetch` against the API's own
 * base URL, same "bypass the typed client for file payloads" pattern the
 * import screen uses.
 */
export function useUploadPolicyDocument() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ policyId, kind, file }: { policyId: string; kind: InsuranceDocumentKind; file: { uri: string; name: string; mimeType: string } }) => {
      const form = new FormData();
      form.append('kind', kind);
      // React Native's FormData accepts a `{ uri, name, type }` object in
      // place of a web `File`/`Blob` — this is RN's own documented shape,
      // not a DOM API, so it's cast past FormData's DOM-typed `.append`.
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

      const accessToken = getAccessToken();
      const response = await fetch(`${API_URL}/insurance/${policyId}/documents`, {
        method: 'POST',
        headers: { 'X-Client': 'mobile', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Dokument se nepodařilo nahrát');
      }
      return response.json() as Promise<{ id: string }>;
    },
    onSuccess: () => invalidateInsuranceQueries(queryClient),
  });
}
