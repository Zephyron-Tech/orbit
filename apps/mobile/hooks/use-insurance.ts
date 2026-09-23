import { File, Paths } from 'expo-file-system';
import * as Sharing from 'expo-sharing';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Linking } from 'react-native';

import { API_URL, apiClient, UnauthorizedError } from '../lib/api-client';
import { getAccessToken } from '../lib/auth-storage';
import type { InsuranceListResponse, InsurancePolicyInput, VehicleCategory } from '../lib/response-types';

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

export function useReorderPolicy() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, direction }: { id: string; direction: -1 | 1 }) =>
      apiClient.insurance.reorder.$post({ json: { id, direction } }).then((response) => unwrapVoid(response, 'Pořadí se nepodařilo změnit')),
    onSuccess: () => invalidateInsuranceQueries(queryClient),
  });
}

export interface GreenCardParsed {
  policyNumber: string;
  plateOrVin: string;
  vehicleType: VehicleCategory;
  make: string;
  validFrom: string;
  validTo: string;
}

export interface ContractParsed {
  policyNumber: string | null;
  licensePlate: string | null;
  vehicleName: string | null;
  vehicleType: VehicleCategory | null;
  annualCost: string | null;
  startDate: string | null;
  warnings: string[];
}

/**
 * `POST /insurance/documents/parse` — multipart, same "bypass the typed RPC
 * client for file payloads" pattern as upload. Doesn't need a `policyId`: web
 * lets this run before a policy is even created, to prefill the form.
 */
export function useParsePolicyDocument() {
  return useMutation({
    mutationFn: async ({ kind, file }: { kind: InsuranceDocumentKind; file: { uri: string; name: string; mimeType: string } }) => {
      const form = new FormData();
      form.append('kind', kind);
      form.append('file', { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob);

      const accessToken = getAccessToken();
      const response = await fetch(`${API_URL}/insurance/documents/parse`, {
        method: 'POST',
        headers: { 'X-Client': 'mobile', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        body: form,
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? 'Nepodařilo se přečíst PDF');
      }
      return response.json() as Promise<GreenCardParsed | ContractParsed>;
    },
  });
}

/**
 * Downloads a stored document via an authenticated request (the download
 * route needs the same bearer token every other call does — a plain
 * `<a href>`/browser-navigated GET, the web app's approach, isn't available
 * on native) and opens it directly — `Linking.openURL` on a local `file://`
 * URI hands the PDF to the system's own viewer (Quick Look on iOS), which
 * already has its own share/save controls, so "open first, share/save from
 * there" needs no extra UI. Falls back to the OS share sheet only if the
 * platform can't open the file URI directly (e.g. Android without a
 * content:// URI). `expo-file-system`'s class-based `File.downloadFileAsync`
 * accepts custom headers directly, so no separate fetch-then-write step.
 */
export function useDownloadPolicyDocument() {
  return useMutation({
    mutationFn: async ({ policyId, documentId, filename }: { policyId: string; documentId: string; filename: string }) => {
      const accessToken = getAccessToken();
      const destination = new File(Paths.cache, filename);

      const file = await File.downloadFileAsync(`${API_URL}/insurance/${policyId}/documents/${documentId}`, destination, {
        headers: { 'X-Client': 'mobile', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
        idempotent: true,
      });

      try {
        await Linking.openURL(file.uri);
        return;
      } catch {
        // Fall through to the share sheet below.
      }

      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(file.uri);
      } else {
        throw new Error(`Dokument uložen do ${file.uri}, ale otevření ani sdílení není na tomto zařízení dostupné.`);
      }
    },
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
