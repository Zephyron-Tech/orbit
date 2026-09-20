import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';

import { API_URL, apiClient, UnauthorizedError } from '../lib/api-client';
import { getAccessToken } from '../lib/auth-storage';
import type { ImportBatchesResponse } from '../lib/response-types';

const BATCHES_KEY = ['import-batches'];

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

export function useImportBatches() {
  return useQuery({
    queryKey: BATCHES_KEY,
    queryFn: () => apiClient.import.batches.$get().then((response) => unwrap<ImportBatchesResponse>(response, 'Přehled importů se nepodařilo načíst')),
  });
}

function invalidateAfterImport(queryClient: ReturnType<typeof useQueryClient>): void {
  void queryClient.invalidateQueries({ queryKey: BATCHES_KEY });
  void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
  void queryClient.invalidateQueries({ queryKey: ['net-worth'] });
  void queryClient.invalidateQueries({ queryKey: ['transactions'] });
}

type PickedFile = { uri: string; name: string; mimeType: string };

function toRnFile(file: PickedFile): Blob {
  // React Native's FormData accepts a `{ uri, name, type }` object in place
  // of a web `File`/`Blob` — RN's own documented shape, cast past
  // FormData's DOM-typed `.append` the same way use-insurance.ts does.
  return { uri: file.uri, name: file.name, type: file.mimeType } as unknown as Blob;
}

async function multipartPost(path: string, form: FormData): Promise<unknown> {
  const accessToken = getAccessToken();
  const response = await fetch(`${API_URL}${path}`, {
    method: 'POST',
    headers: { 'X-Client': 'mobile', ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: form,
  });
  const body = await response.json().catch(() => null);
  if (response.status === 401) throw new UnauthorizedError();
  if (!response.ok) throw new Error((body as { error?: string } | null)?.error ?? 'Import se nezdařil');
  return body;
}

export interface CsvImportSummary {
  dryRun: boolean;
  rowCount: number;
  inserted: number;
  needsAnchor: boolean;
  [key: string]: unknown;
}

/**
 * CSV import genuinely supports a two-step dry-run/commit flow (the API's
 * `dryRun` field, not invented here) — the screen calls this once with
 * `dryRun: true` for a preview, then again with `dryRun: false` to commit.
 */
export function useImportCsv() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ accountId, file, dryRun }: { accountId: string; file: PickedFile; dryRun: boolean }) => {
      const form = new FormData();
      form.append('accountId', accountId);
      form.append('dryRun', String(dryRun));
      form.append('file', toRnFile(file));
      return multipartPost('/import/csv', form) as Promise<CsvImportSummary>;
    },
    onSuccess: (_result, variables) => {
      if (!variables.dryRun) invalidateAfterImport(queryClient);
    },
  });
}

/**
 * Fuel receipts, top-ups, and the Sales.xls fuel export don't get a
 * dry-run preview in this pass (single-shot upload, always committed) —
 * CSV is the highest-volume/highest-risk import type and is the one that
 * gets the preview step; these three are simpler occasional uploads.
 */
export function useImportFuelReceipt() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (files: PickedFile[]) => {
      const form = new FormData();
      for (const file of files) form.append('file', toRnFile(file));
      form.append('dryRun', 'false');
      return multipartPost('/import/fuel-receipt', form);
    },
    onSuccess: () => invalidateAfterImport(queryClient),
  });
}

export function useRematchFuelReceipts() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => apiClient.import['fuel-receipt'].rematch.$post().then((response) => unwrap<unknown>(response, 'Spárování se nezdařilo')),
    onSuccess: () => invalidateAfterImport(queryClient),
  });
}

export function useImportFuelTopups() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: PickedFile) => {
      const form = new FormData();
      form.append('file', toRnFile(file));
      form.append('dryRun', 'false');
      return multipartPost('/import/fuel-topups', form);
    },
    onSuccess: () => invalidateAfterImport(queryClient),
  });
}

export function useImportFuelSales() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (file: PickedFile) => {
      const form = new FormData();
      form.append('file', toRnFile(file));
      form.append('dryRun', 'false');
      return multipartPost('/import/fuel', form);
    },
    onSuccess: () => invalidateAfterImport(queryClient),
  });
}
