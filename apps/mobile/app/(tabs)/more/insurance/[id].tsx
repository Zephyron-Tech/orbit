import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { CloudArrowUpIcon, DownloadSimpleIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../../components/button';
import { TextField } from '../../../../components/text-field';
import {
  useCreatePolicy,
  useDeletePolicy,
  useDownloadPolicyDocument,
  useInsuranceList,
  useParsePolicyDocument,
  useUpdatePolicy,
  useUploadPolicyDocument,
} from '../../../../hooks/use-insurance';
import type { ContractParsed, GreenCardParsed, InsuranceDocumentKind } from '../../../../hooks/use-insurance';
import { formatMoney } from '../../../../lib/format-money';
import type { InsuranceDocumentInfo, InsurancePolicyInput, PaymentFrequency, PolicyStatus, VehicleCategory } from '../../../../lib/response-types';

const VEHICLE_TYPE_OPTIONS: { value: VehicleCategory; label: string }[] = [
  { value: 'CAR', label: 'Osobní auto' },
  { value: 'MOTORCYCLE', label: 'Motocykl' },
  { value: 'TRUCK_OR_TRACTOR', label: 'Nákladní auto / traktor' },
  { value: 'MOPED', label: 'Moped' },
  { value: 'BUS', label: 'Autobus' },
  { value: 'TRAILER', label: 'Přívěs' },
  { value: 'OTHER', label: 'Ostatní' },
];

const FREQUENCY_OPTIONS: { value: PaymentFrequency; label: string }[] = [
  { value: 'ANNUAL', label: 'Ročně' },
  { value: 'SEMI_ANNUAL', label: 'Pololetně' },
  { value: 'MONTHLY', label: 'Měsíčně' },
];

const STATUS_OPTIONS: { value: PolicyStatus; label: string }[] = [
  { value: 'ACTIVE', label: 'Aktivní' },
  { value: 'PAID', label: 'Zaplaceno' },
  { value: 'PENDING_RENEWAL', label: 'Blíží se obnova' },
  { value: 'TERMINATED', label: 'Ukončeno' },
];

function ChoiceRow<T extends string>({ options, value, onChange }: { options: { value: T; label: string }[]; value: T; onChange: (value: T) => void }): React.JSX.Element {
  return (
    <View className="flex-row flex-wrap gap-2">
      {options.map((option) => (
        <Pressable
          key={option.value}
          onPress={() => onChange(option.value)}
          className={`rounded-full border px-3 py-1.5 active:bg-surface-subtle ${value === option.value ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
        >
          <Text className={value === option.value ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{option.label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

const EMPTY_FORM: InsurancePolicyInput = {
  vehicleName: '',
  licensePlate: '',
  policyNumber: '',
  policyHolder: '',
  vehicleType: 'CAR',
  annualCost: '',
  paymentFrequency: 'ANNUAL',
  startDate: new Date().toISOString().slice(0, 10),
  status: 'ACTIVE',
};

/** Upload a document, matching what `expo-document-picker`'s asset shape gives us. */
async function pickAndUpload(
  policyId: string,
  kind: InsuranceDocumentKind,
  upload: ReturnType<typeof useUploadPolicyDocument>,
  onDone: (message: string) => void,
): Promise<void> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
  if (picked.canceled || !picked.assets[0]) return;

  const asset = picked.assets[0];
  upload.mutate(
    { policyId, kind, file: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' } },
    {
      onSuccess: () => onDone('Dokument byl nahrán.'),
      onError: (error) => Alert.alert('Nahrání se nezdařilo', error instanceof Error ? error.message : 'Zkuste to znovu.'),
    },
  );
}

/**
 * Pick a PDF and extract fields from it, without storing anything — works
 * even before the policy exists (`policyId` is not required for parsing).
 */
async function pickAndParse(
  kind: InsuranceDocumentKind,
  parse: ReturnType<typeof useParsePolicyDocument>,
  onParsed: (fields: GreenCardParsed | ContractParsed) => void,
): Promise<void> {
  const picked = await DocumentPicker.getDocumentAsync({ type: 'application/pdf' });
  if (picked.canceled || !picked.assets[0]) return;

  const asset = picked.assets[0];
  parse.mutate(
    { kind, file: { uri: asset.uri, name: asset.name, mimeType: asset.mimeType ?? 'application/pdf' } },
    {
      onSuccess: (fields) => onParsed(fields),
      onError: (error) => Alert.alert('Načtení se nezdařilo', error instanceof Error ? error.message : 'Zkuste to znovu.'),
    },
  );
}

/**
 * Green card never sets `startDate` — it can be reissued mid-term with a
 * different valid-from date than the actual contract start (real case:
 * reissue after a vehicle change), which would silently shift sinking-fund
 * due-date math. Only the contract parser's own "účinná od" line may set
 * it — mirrors apps/web/components/insurance/insurance-manager.tsx exactly.
 */
function applyGreenCard(current: InsurancePolicyInput, fields: GreenCardParsed): InsurancePolicyInput {
  return {
    ...current,
    policyNumber: fields.policyNumber || current.policyNumber,
    licensePlate: fields.plateOrVin || current.licensePlate,
    vehicleType: fields.vehicleType ?? current.vehicleType,
  };
}

function applyContract(current: InsurancePolicyInput, fields: ContractParsed): InsurancePolicyInput {
  return {
    ...current,
    policyNumber: fields.policyNumber ?? current.policyNumber,
    licensePlate: fields.licensePlate ?? current.licensePlate,
    vehicleName: fields.vehicleName ?? current.vehicleName,
    vehicleType: fields.vehicleType ?? current.vehicleType,
    annualCost: fields.annualCost ?? current.annualCost,
    startDate: fields.startDate ?? current.startDate,
  };
}

export default function PolicyDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const { data: listData } = useInsuranceList();
  const policy = listData?.policies.find((row) => row.id === id) ?? null;

  const createPolicy = useCreatePolicy();
  const updatePolicy = useUpdatePolicy();
  const deletePolicy = useDeletePolicy();
  const uploadDocument = useUploadPolicyDocument();
  const parseDocument = useParsePolicyDocument();
  const downloadDocument = useDownloadPolicyDocument();

  const [form, setForm] = useState<InsurancePolicyInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  function handleDownload(document: InsuranceDocumentInfo): void {
    if (!policy) return;
    downloadDocument.mutate(
      { policyId: policy.id, documentId: document.id, filename: document.filename },
      { onError: (mutationError) => Alert.alert('Nepodařilo se otevřít', mutationError instanceof Error ? mutationError.message : 'Zkuste to znovu.') },
    );
  }

  useEffect(() => {
    if (policy) {
      setForm({
        vehicleName: policy.vehicleName,
        licensePlate: policy.licensePlate,
        policyNumber: policy.policyNumber,
        policyHolder: policy.policyHolder,
        vehicleType: policy.vehicleType,
        annualCost: policy.annualCost,
        paymentFrequency: policy.paymentFrequency,
        startDate: policy.startDate,
        status: policy.status,
      });
    }
  }, [policy]);

  if (!isNew && !policy && listData) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">Pojistka nenalezena</Text>
      </View>
    );
  }

  if (!isNew && !policy) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  function handleSave(): void {
    setError(null);
    const onError = (mutationError: unknown) => setError(mutationError instanceof Error ? mutationError.message : 'Uložení se nezdařilo');

    if (isNew) {
      createPolicy.mutate(form, { onSuccess: () => router.back(), onError });
    } else if (policy) {
      updatePolicy.mutate({ id: policy.id, input: form }, { onSuccess: () => router.back(), onError });
    }
  }

  function handleDelete(): void {
    if (!policy) return;
    Alert.alert('Smazat pojistku?', policy.vehicleName, [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Smazat',
        style: 'destructive',
        onPress: () => deletePolicy.mutate(policy.id, { onSuccess: () => router.back() }),
      },
    ]);
  }

  const saving = createPolicy.isPending || updatePolicy.isPending;

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-4 p-4">
      <View className="gap-2 rounded-lg border border-line bg-surface p-4">
        <Text className="font-sans-medium text-sm text-ink-muted">Rozpoznat z PDF</Text>
        <Text className="text-xs text-ink-muted">Vybere se PDF, vyplní se odpovídající pole níže — nic se tím nenahraje.</Text>
        <View className="flex-row gap-2">
          <Button
            variant="secondary"
            className="flex-1"
            disabled={parseDocument.isPending}
            onPress={() => void pickAndParse('CONTRACT', parseDocument, (fields) => setForm((current) => applyContract(current, fields as ContractParsed)))}
          >
            Ze smlouvy
          </Button>
          <Button
            variant="secondary"
            className="flex-1"
            disabled={parseDocument.isPending}
            onPress={() => void pickAndParse('GREEN_CARD', parseDocument, (fields) => setForm((current) => applyGreenCard(current, fields as GreenCardParsed)))}
          >
            Ze zelené karty
          </Button>
        </View>
        {parseDocument.isPending ? <Text className="text-xs text-ink-muted">Čtu PDF…</Text> : null}
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Vozidlo</Text>
        <TextField
          placeholder="Název vozidla"
          value={form.vehicleName}
          onChangeText={(value) => setForm((current) => ({ ...current, vehicleName: value }))}
          returnKeyType="next"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">SPZ</Text>
        <TextField
          value={form.licensePlate}
          onChangeText={(value) => setForm((current) => ({ ...current, licensePlate: value }))}
          autoCapitalize="characters"
          returnKeyType="next"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Typ vozidla</Text>
        <ChoiceRow options={VEHICLE_TYPE_OPTIONS} value={form.vehicleType} onChange={(value) => setForm((current) => ({ ...current, vehicleType: value }))} />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Číslo pojistky</Text>
        <TextField
          value={form.policyNumber}
          onChangeText={(value) => setForm((current) => ({ ...current, policyNumber: value }))}
          returnKeyType="next"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Pojistník</Text>
        <TextField
          value={form.policyHolder}
          onChangeText={(value) => setForm((current) => ({ ...current, policyHolder: value }))}
          returnKeyType="next"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Roční pojistné (Kč)</Text>
        <TextField
          variant="money"
          value={form.annualCost}
          onChangeText={(value) => setForm((current) => ({ ...current, annualCost: value }))}
          returnKeyType="next"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Frekvence plateb</Text>
        <ChoiceRow options={FREQUENCY_OPTIONS} value={form.paymentFrequency} onChange={(value) => setForm((current) => ({ ...current, paymentFrequency: value }))} />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Datum začátku (RRRR-MM-DD)</Text>
        <TextField
          value={form.startDate}
          onChangeText={(value) => setForm((current) => ({ ...current, startDate: value }))}
          returnKeyType="done"
        />
      </View>

      <View>
        <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Stav</Text>
        <ChoiceRow options={STATUS_OPTIONS} value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
      </View>

      {error ? <Text className="text-sm text-critical">{error}</Text> : null}

      <Button variant="primary" loading={saving} onPress={handleSave}>
        Uložit
      </Button>

      {!isNew && policy ? (
        <>
          <View className="mt-2 gap-3 rounded-lg border border-line bg-surface p-4">
            <Text className="font-sans-medium text-sm text-ink-muted">Dokumenty</Text>

            <View className="flex-row items-center justify-between">
              <Text className="text-ink">Smlouva {policy.documents.contract ? '✓' : ''}</Text>
              <View className="flex-row gap-2">
                {policy.documents.contract ? (
                  <Pressable
                    onPress={() => handleDownload(policy.documents.contract as InsuranceDocumentInfo)}
                    disabled={downloadDocument.isPending}
                    className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-3 py-1.5 active:bg-line"
                  >
                    <DownloadSimpleIcon color="#17211f" size={14} weight="regular" />
                    <Text className="text-sm text-ink">Otevřít</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void pickAndUpload(policy.id, 'CONTRACT', uploadDocument, setUploadMessage)}
                  disabled={uploadDocument.isPending}
                  className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-3 py-1.5 active:bg-line"
                >
                  <CloudArrowUpIcon color="#17211f" size={14} weight="regular" />
                  <Text className="text-sm text-ink">Nahrát</Text>
                </Pressable>
              </View>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-ink">Zelená karta {policy.documents.greenCard ? '✓' : ''}</Text>
              <View className="flex-row gap-2">
                {policy.documents.greenCard ? (
                  <Pressable
                    onPress={() => handleDownload(policy.documents.greenCard as InsuranceDocumentInfo)}
                    disabled={downloadDocument.isPending}
                    className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-3 py-1.5 active:bg-line"
                  >
                    <DownloadSimpleIcon color="#17211f" size={14} weight="regular" />
                    <Text className="text-sm text-ink">Otevřít</Text>
                  </Pressable>
                ) : null}
                <Pressable
                  onPress={() => void pickAndUpload(policy.id, 'GREEN_CARD', uploadDocument, setUploadMessage)}
                  disabled={uploadDocument.isPending}
                  className="flex-row items-center gap-1 rounded-md bg-surface-subtle px-3 py-1.5 active:bg-line"
                >
                  <CloudArrowUpIcon color="#17211f" size={14} weight="regular" />
                  <Text className="text-sm text-ink">Nahrát</Text>
                </Pressable>
              </View>
            </View>

            {uploadMessage ? <Text className="text-sm text-positive">{uploadMessage}</Text> : null}
          </View>

          <Button variant="destructive" onPress={handleDelete}>
            Smazat pojistku
          </Button>
        </>
      ) : null}
    </ScrollView>
  );
}
