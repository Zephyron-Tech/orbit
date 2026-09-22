import * as DocumentPicker from 'expo-document-picker';
import { ArrowsClockwiseIcon, UploadSimpleIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { ActivityIndicator, Alert, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { TextField } from '../../../components/text-field';
import {
  useImportBatches,
  useImportCsv,
  useImportFuelReceipt,
  useImportFuelSales,
  useImportFuelTopups,
  useRematchFuelReceipts,
  type CsvImportSummary,
} from '../../../hooks/use-import';
import { formatMoney } from '../../../lib/format-money';
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
          className={`rounded-full border px-3 py-1.5 active:bg-surface-subtle ${selectedId === account.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
        >
          <Text className={selectedId === account.id ? 'font-sans-medium text-accent' : 'text-ink-muted'} numberOfLines={1}>
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
  const [closingBalance, setClosingBalance] = useState('');

  async function handlePick(): Promise<void> {
    if (!accountId) {
      Alert.alert('Vyberte účet', 'Nejdřív zvolte účet, do kterého se má výpis importovat.');
      return;
    }
    const file = await pickOne(['text/csv', 'text/xml', 'application/xml', 'application/pdf']);
    if (!file) return;

    setPendingFile(file);
    setPreview(null);
    setClosingBalance('');
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
    if (preview?.needsAnchor && !closingBalance.trim()) {
      Alert.alert('Chybí zůstatek', 'Doplňte počáteční zůstatek, ať se výpis dá ukotvit.');
      return;
    }
    importCsv.mutate(
      { accountId, file: pendingFile, dryRun: false, closingBalance: closingBalance.trim() || undefined },
      {
        onSuccess: () => {
          Alert.alert('Hotovo', 'Výpis byl naimportován.');
          setPendingFile(null);
          setPreview(null);
          setClosingBalance('');
        },
        onError: (error) => Alert.alert('Import se nezdařil', error instanceof Error ? error.message : 'Zkuste to znovu.'),
      },
    );
  }

  return (
    <View className="gap-3 border-b border-line bg-surface p-4">
      <Text className="font-sans-medium text-sm text-ink-muted">Bankovní výpis (CSV, XML, PDF)</Text>
      <AccountPicker accounts={accounts} selectedId={accountId} onSelect={setAccountId} />
      <Button variant="secondary" icon={UploadSimpleIcon} loading={importCsv.isPending && !preview} onPress={() => void handlePick()}>
        Vybrat soubor
      </Button>

      {preview ? (
        <View className="gap-2 rounded-lg bg-surface-subtle p-3">
          <Text className="text-sm text-ink">Řádků: {preview.rowCount}</Text>
          <Text className="text-sm text-ink">Nových: {preview.inserted}</Text>

          {preview.needsAnchor ? (
            <View className="gap-1">
              <Text className="text-sm text-warning">Chybí počáteční zůstatek — doplňte ho ručně, ať se výpis dá ukotvit.</Text>
              <TextField
                variant="money"
                placeholder="Zůstatek po posledním řádku, např. 12345,67"
                value={closingBalance}
                onChangeText={setClosingBalance}
                returnKeyType="done"
              />
            </View>
          ) : null}

          {preview.preview.length > 0 ? (
            <View className="gap-1">
              <Text className="font-sans-medium text-xs text-ink-muted">Náhled řádků (prvních {preview.preview.length})</Text>
              {preview.preview.map((row, index) => (
                <View key={`${row.externalId ?? index}`} className="flex-row items-center justify-between border-b border-line py-1.5">
                  <View className="flex-1 pr-2">
                    <Text className="text-sm text-ink" numberOfLines={1}>
                      {row.merchant ?? '—'}
                    </Text>
                    <Text className="text-xs text-ink-muted">
                      {row.date}
                      {row.duplicate ? ' · duplicitní' : ''}
                      {row.internalTransfer ? ' · vlastní převod' : ''}
                    </Text>
                  </View>
                  <Text className={`text-sm ${row.duplicate ? 'text-ink-faint' : 'text-ink'}`}>
                    {formatMoney(row.amount, row.currency)}
                  </Text>
                </View>
              ))}
            </View>
          ) : null}

          <Button variant="primary" loading={importCsv.isPending} onPress={handleCommit}>
            Potvrdit import
          </Button>
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
    <Button variant="secondary" icon={UploadSimpleIcon} loading={pending} onPress={() => void handlePress()}>
      {label}
    </Button>
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
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Import se nepodařilo připravit'}</Text>
      </View>
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView className="flex-1 bg-canvas">
      <CsvImportSection accounts={data.accounts} />

      <View className="gap-3 border-b border-line bg-surface p-4">
        <Text className="font-sans-medium text-sm text-ink-muted">Tankarta</Text>
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
        <Button
          variant="secondary"
          icon={ArrowsClockwiseIcon}
          loading={rematchFuelReceipts.isPending}
          onPress={() => rematchFuelReceipts.mutate(undefined, { onSuccess: () => Alert.alert('Hotovo', 'Spárování bylo dokončeno.') })}
        >
          Znovu spárovat účtenky
        </Button>
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

      <Text className="font-sans-medium px-4 pb-2 pt-4 text-sm text-ink-muted">Poslední importy</Text>
      {data.batches.length === 0 ? (
        <Text className="px-4 pb-4 text-ink-muted">Zatím žádné importy.</Text>
      ) : (
        data.batches.map((batch) => (
          <View key={batch.id} className="flex-row items-center justify-between border-b border-line bg-surface px-4 py-3">
            <Text className="flex-1 pr-3 text-ink" numberOfLines={1}>
              {batch.account.name}
            </Text>
            <Text className="text-xs text-ink-muted">{new Date(batch.createdAt).toLocaleDateString('cs-CZ')}</Text>
          </View>
        ))
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
