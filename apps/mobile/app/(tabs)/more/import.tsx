import * as DocumentPicker from 'expo-document-picker';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import {
  useImportBatches,
  useImportCsv,
  useImportFuelReceipt,
  useImportFuelSales,
  useImportFuelTopups,
  useRematchFuelReceipts,
  type CsvImportSummary,
} from '../../../hooks/use-import';
import type { ImportAccountOption } from '../../../lib/response-types';

type PickedAsset = { uri: string; name: string; mimeType: string };

async function pickOne(type: string | string[]): Promise<PickedAsset | null> {
  const result = await DocumentPicker.getDocumentAsync({ type });
  if (result.canceled || !result.assets[0]) return null;
  const asset = result.assets[0];
  return { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/octet-stream' };
}

function AccountPicker({ accounts, selectedId, onSelect }: { accounts: ImportAccountOption[]; selectedId: string | null; onSelect: (id: string) => void }): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-2">
      {accounts.map((account) => (
        <Pressable
          key={account.id}
          onPress={() => onSelect(account.id)}
          className={`rounded-full border px-3 py-1.5 ${selectedId === account.id ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
        >
          <Text className={selectedId === account.id ? 'text-white' : 'text-neutral-700'} numberOfLines={1}>
            {account.name}
          </Text>
        </Pressable>
      ))}
    </View>
  );
}

/** CSV/XML/PDF statement import: pick account → dry run preview → confirm to commit. */
function CsvImportSection({ accounts }: { accounts: ImportAccountOption[] }): React.JSX.Element {
  const importCsv = useImportCsv();
  const [accountId, setAccountId] = useState<string | null>(null);
  const [pendingFile, setPendingFile] = useState<PickedAsset | null>(null);
  const [preview, setPreview] = useState<CsvImportSummary | null>(null);

  async function handlePick(): Promise<void> {
    if (!accountId) {
      Alert.alert('Vyberte účet', 'Nejdřív zvolte účet, do kterého se má výpis importovat.');
      return;
    }
    const file = await pickOne(['text/csv', 'text/xml', 'application/xml', 'application/pdf']);
    if (!file) return;

    setPendingFile(file);
    setPreview(null);
    importCsv.mutate(
      { accountId, file, dryRun: true },
      {
        onSuccess: (summary) => setPreview(summary),
        onError: (error) => Alert.alert('Náhled se nezdařil', error instanceof Error ? error.message : 'Zkuste to znovu.'),
      },
    );
  }

  function handleCommit(): void {
    if (!accountId || !pendingFile) return;
    importCsv.mutate(
      { accountId, file: pendingFile, dryRun: false },
      {
        onSuccess: () => {
          Alert.alert('Hotovo', 'Výpis byl naimportován.');
          setPendingFile(null);
          setPreview(null);
        },
        onError: (error) => Alert.alert('Import se nezdařil', error instanceof Error ? error.message : 'Zkuste to znovu.'),
      },
    );
  }

  return (
    <View className="gap-3 border-b border-neutral-100 p-4">
      <Text className="text-sm font-medium text-neutral-500">Bankovní výpis (CSV, XML, PDF)</Text>
      <AccountPicker accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
      <Pressable onPress={() => void handlePick()} disabled={importCsv.isPending} className="items-center rounded-lg border border-neutral-300 py-2.5">
        <Text className="font-medium text-neutral-900">{importCsv.isPending && !preview ? 'Načítám náhled…' : 'Vybrat soubor'}</Text>
      </Pressable>

      {preview ? (
        <View className="gap-2 rounded-lg bg-neutral-50 p-3">
          <Text className="text-sm text-neutral-700">Řádků: {preview.rowCount}</Text>
          <Text className="text-sm text-neutral-700">Nových: {preview.inserted}</Text>
          {preview.needsAnchor ? <Text className="text-sm text-amber-700">Chybí počáteční zůstatek — bude potřeba doplnit ručně.</Text> : null}
          <Pressable onPress={handleCommit} disabled={importCsv.isPending} className="items-center rounded-lg bg-neutral-900 py-2.5">
            <Text className="font-medium text-white">{importCsv.isPending ? 'Importuji…' : 'Potvrdit import'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

function SingleFileUploadButton({
  label,
  accept,
  onUpload,
  pending,
}: {
  label: string;
  accept: string;
  onUpload: (file: PickedAsset) => void;
  pending: boolean;
}): React.JSX.Element {
  async function handlePress(): Promise<void> {
    const file = await pickOne(accept);
    if (file) onUpload(file);
  }

  return (
    <Pressable onPress={() => void handlePress()} disabled={pending} className="items-center rounded-lg border border-neutral-300 py-2.5">
      <Text className="font-medium text-neutral-900">{pending ? 'Nahrávám…' : label}</Text>
    </Pressable>
  );
}

export default function ImportScreen(): React.JSX.Element {
  const { data, isPending, isError, error } = useImportBatches();
  const importFuelReceipt = useImportFuelReceipt();
  const rematchFuelReceipts = useRematchFuelReceipts();
  const importFuelTopups = useImportFuelTopups();
  const importFuelSales = useImportFuelSales();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Import se nepodařilo připravit'}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-white">
      <CsvImportSection accounts={data.accounts} />

      <View className="gap-3 border-b border-neutral-100 p-4">
        <Text className="text-sm font-medium text-neutral-500">Tankarta</Text>
        <SingleFileUploadButton
          label="Nahrát účtenku (PDF)"
          accept="application/pdf"
          pending={importFuelReceipt.isPending}
          onUpload={(file) =>
            importFuelReceipt.mutate([file], {
              onSuccess: () => Alert.alert('Hotovo', 'Účtenka byla nahrána.'),
              onError: (error) => Alert.alert('Nahrání se nezdařilo', error instanceof Error ? error.message : 'Zkuste to znovu.'),
            })
          }
        />
        <Pressable
          onPress={() => rematchFuelReceipts.mutate(undefined, { onSuccess: () => Alert.alert('Hotovo', 'Spárování bylo dokončeno.') })}
          disabled={rematchFuelReceipts.isPending}
          className="items-center rounded-lg border border-neutral-300 py-2.5"
        >
          <Text className="font-medium text-neutral-900">{rematchFuelReceipts.isPending ? 'Spárovávám…' : 'Znovu spárovat účtenky'}</Text>
        </Pressable>
        <SingleFileUploadButton
          label="Nahrát ChargingPrepaids.xls"
          accept="application/vnd.ms-excel"
          pending={importFuelTopups.isPending}
          onUpload={(file) =>
            importFuelTopups.mutate(file, {
              onSuccess: () => Alert.alert('Hotovo', 'Dobití bylo naimportováno.'),
              onError: (error) => Alert.alert('Import se nezdařil', error instanceof Error ? error.message : 'Zkuste to znovu.'),
            })
          }
        />
        <SingleFileUploadButton
          label="Nahrát Sales.xls"
          accept="application/vnd.ms-excel"
          pending={importFuelSales.isPending}
          onUpload={(file) =>
            importFuelSales.mutate(file, {
              onSuccess: () => Alert.alert('Hotovo', 'Nákupy byly naimportovány.'),
              onError: (error) => Alert.alert('Import se nezdařil', error instanceof Error ? error.message : 'Zkuste to znovu.'),
            })
          }
        />
      </View>

      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Poslední importy</Text>
      {data.batches.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Zatím žádné importy.</Text>
      ) : (
        data.batches.map((batch) => (
          <View key={batch.id} className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
            <Text className="flex-1 pr-3 text-neutral-900" numberOfLines={1}>
              {batch.account.name}
            </Text>
            <Text className="text-xs text-neutral-500">{new Date(batch.createdAt).toLocaleDateString('cs-CZ')}</Text>
          </View>
        ))
      )}
    </ScrollView>
  );
}
