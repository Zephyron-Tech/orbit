import * as DocumentPicker from 'expo-document-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useCreatePolicy, useDeletePolicy, useInsuranceList, useUpdatePolicy, useUploadPolicyDocument } from '../../../../hooks/use-insurance';
import type { InsuranceDocumentKind } from '../../../../hooks/use-insurance';
import type { InsurancePolicyInput, PaymentFrequency, PolicyStatus, VehicleCategory } from '../../../../lib/response-types';

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
          className={`rounded-full border px-3 py-1.5 ${value === option.value ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
        >
          <Text className={value === option.value ? 'text-white' : 'text-neutral-700'}>{option.label}</Text>
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

  const [form, setForm] = useState<InsurancePolicyInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

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
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">Pojistka nenalezena</Text>
      </View>
    );
  }

  if (!isNew && !policy) {
    return (
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
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
    <ScrollView className="flex-1 bg-white" contentContainerClassName="gap-4 p-4">
      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Vozidlo</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          placeholder="Název vozidla"
          value={form.vehicleName}
          onChangeText={(value) => setForm((current) => ({ ...current, vehicleName: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">SPZ</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.licensePlate}
          onChangeText={(value) => setForm((current) => ({ ...current, licensePlate: value }))}
          autoCapitalize="characters"
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Typ vozidla</Text>
        <ChoiceRow options={VEHICLE_TYPE_OPTIONS} value={form.vehicleType} onChange={(value) => setForm((current) => ({ ...current, vehicleType: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Číslo pojistky</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.policyNumber}
          onChangeText={(value) => setForm((current) => ({ ...current, policyNumber: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Pojistník</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.policyHolder}
          onChangeText={(value) => setForm((current) => ({ ...current, policyHolder: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Roční pojistné (Kč)</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          keyboardType="numbers-and-punctuation"
          value={form.annualCost}
          onChangeText={(value) => setForm((current) => ({ ...current, annualCost: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Frekvence plateb</Text>
        <ChoiceRow options={FREQUENCY_OPTIONS} value={form.paymentFrequency} onChange={(value) => setForm((current) => ({ ...current, paymentFrequency: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Datum začátku (RRRR-MM-DD)</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.startDate}
          onChangeText={(value) => setForm((current) => ({ ...current, startDate: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Stav</Text>
        <ChoiceRow options={STATUS_OPTIONS} value={form.status} onChange={(value) => setForm((current) => ({ ...current, status: value }))} />
      </View>

      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}

      <Pressable onPress={handleSave} disabled={saving} className="items-center rounded-lg bg-neutral-900 py-3">
        <Text className="font-medium text-white">{saving ? 'Ukládám…' : 'Uložit'}</Text>
      </Pressable>

      {!isNew && policy ? (
        <>
          <View className="mt-2 gap-3 rounded-xl border border-neutral-200 p-4">
            <Text className="text-sm font-medium text-neutral-500">Dokumenty</Text>

            <View className="flex-row items-center justify-between">
              <Text className="text-neutral-900">Smlouva {policy.documents.contract ? '✓' : ''}</Text>
              <Pressable
                onPress={() => void pickAndUpload(policy.id, 'CONTRACT', uploadDocument, setUploadMessage)}
                disabled={uploadDocument.isPending}
                className="rounded-md bg-neutral-100 px-3 py-1.5"
              >
                <Text className="text-sm text-neutral-700">Nahrát</Text>
              </Pressable>
            </View>

            <View className="flex-row items-center justify-between">
              <Text className="text-neutral-900">Zelená karta {policy.documents.greenCard ? '✓' : ''}</Text>
              <Pressable
                onPress={() => void pickAndUpload(policy.id, 'GREEN_CARD', uploadDocument, setUploadMessage)}
                disabled={uploadDocument.isPending}
                className="rounded-md bg-neutral-100 px-3 py-1.5"
              >
                <Text className="text-sm text-neutral-700">Nahrát</Text>
              </Pressable>
            </View>

            {uploadMessage ? <Text className="text-sm text-emerald-600">{uploadMessage}</Text> : null}
            <Text className="text-xs text-neutral-400">
              Stažení dokumentu zatím není na mobilu k dispozici — otevřete pojistku ve webové appce.
            </Text>
          </View>

          <Pressable onPress={handleDelete} className="items-center rounded-lg border border-red-200 py-3">
            <Text className="font-medium text-red-600">Smazat pojistku</Text>
          </Pressable>
        </>
      ) : null}
    </ScrollView>
  );
}
