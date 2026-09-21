import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View, ActivityIndicator } from 'react-native';

import {
  useAccountsList,
  useClearCreditCapacitySnapshot,
  useConfirmCreditZeroStart,
  useCreateAccount,
  useDeleteAccount,
  useRecordCreditDebt,
  useSetAccountArchived,
  useUpdateAccount,
} from '../../../../hooks/use-accounts';
import type { AccountInput, AccountProvider, AccountType } from '../../../../lib/response-types';

function formatMoney(value: string, currency: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedFraction = fraction?.replace(/0+$/, '');
  return `${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''} ${currency}`;
}

/** Inline "record current debt" form — mirrors apps/web's CreditDebtForm. */
function CreditDebtForm({
  currency,
  disabled,
  onCancel,
  onSubmit,
}: {
  currency: string;
  disabled: boolean;
  onCancel: () => void;
  onSubmit: (values: { debt: string; asOf: string }) => void;
}): React.JSX.Element {
  const [debt, setDebt] = useState('');
  const [asOf, setAsOf] = useState(() => new Date().toISOString().slice(0, 10));

  return (
    <View className="gap-3 rounded-lg border border-neutral-200 bg-neutral-50 p-3">
      <Text className="text-sm text-neutral-500">Zadejte kladný aktuální dluh. Uloží se jako záporný zůstatek účtu.</Text>
      <View>
        <Text className="mb-1 text-xs font-medium text-neutral-500">Aktuální dluh ({currency})</Text>
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" keyboardType="decimal-pad" value={debt} onChangeText={setDebt} placeholder="5000" />
      </View>
      <View>
        <Text className="mb-1 text-xs font-medium text-neutral-500">Platný k datu (RRRR-MM-DD)</Text>
        <TextInput className="rounded-lg border border-neutral-300 px-3 py-2" value={asOf} onChangeText={setAsOf} placeholder="2026-01-01" />
      </View>
      <View className="flex-row gap-2">
        <Pressable onPress={onCancel} disabled={disabled} className="flex-1 items-center rounded-lg border border-neutral-300 py-2.5">
          <Text className="font-medium text-neutral-900">Zrušit</Text>
        </Pressable>
        <Pressable onPress={() => onSubmit({ debt, asOf })} disabled={disabled || !debt} className="flex-1 items-center rounded-lg bg-neutral-900 py-2.5">
          <Text className="font-medium text-white">{disabled ? 'Ukládám…' : 'Uložit dluh'}</Text>
        </Pressable>
      </View>
    </View>
  );
}

const TYPE_OPTIONS: { value: AccountType; label: string }[] = [
  { value: 'CHECKING', label: 'Běžný' },
  { value: 'SAVINGS', label: 'Spořicí' },
  { value: 'INVESTMENT', label: 'Investiční' },
  { value: 'CREDIT', label: 'Kreditní' },
];

const PROVIDER_OPTIONS: { value: AccountProvider; label: string }[] = [
  { value: 'MONETA', label: 'Moneta' },
  { value: 'REVOLUT', label: 'Revolut' },
  { value: 'TRADING212', label: 'Trading 212' },
  { value: 'MANUAL', label: 'Ruční evidence' },
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

const EMPTY_FORM: AccountInput = {
  name: '',
  type: 'CHECKING',
  provider: 'MANUAL',
  externalId: null,
  currency: 'CZK',
  includeInNetWorth: true,
  creditLimit: null,
  cardLast4: null,
  emergencyReserveMonths: null,
  annualInterestRate: null,
  interestTaxRate: null,
};

export default function AccountDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const isNew = id === 'new';

  const { data: accounts } = useAccountsList();
  const account = accounts?.find((row) => row.id === id) ?? null;

  const createAccount = useCreateAccount();
  const updateAccount = useUpdateAccount();
  const setArchived = useSetAccountArchived();
  const deleteAccount = useDeleteAccount();
  const recordCreditDebt = useRecordCreditDebt();
  const confirmCreditZeroStart = useConfirmCreditZeroStart();
  const clearCreditCapacitySnapshot = useClearCreditCapacitySnapshot();

  const [form, setForm] = useState<AccountInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);
  const [recordingDebt, setRecordingDebt] = useState(false);
  const [creditMessage, setCreditMessage] = useState<string | null>(null);

  useEffect(() => {
    if (account) {
      setForm({
        name: account.name,
        type: account.type,
        provider: account.provider,
        externalId: account.externalId,
        currency: account.currency,
        includeInNetWorth: account.includeInNetWorth,
        creditLimit: account.creditLimit,
        cardLast4: account.cardLast4,
        emergencyReserveMonths: account.emergencyReserveMonths,
        annualInterestRate: account.annualInterestRate,
        interestTaxRate: account.interestTaxRate,
      });
    }
  }, [account]);

  if (!isNew && !account && accounts) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">Účet nenalezen</Text>
      </View>
    );
  }

  if (!isNew && !account) {
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
      createAccount.mutate(form, { onSuccess: () => router.back(), onError });
    } else if (account) {
      updateAccount.mutate({ id: account.id, input: form }, { onSuccess: () => router.back(), onError });
    }
  }

  function handleDelete(): void {
    if (!account) return;
    if (account.transactionCount > 0) {
      Alert.alert('Nelze smazat', `Účet má ${account.transactionCount} transakcí. Místo smazání ho archivujte.`);
      return;
    }
    Alert.alert('Smazat účet?', account.name, [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Smazat', style: 'destructive', onPress: () => deleteAccount.mutate(account.id, { onSuccess: () => router.back() }) },
    ]);
  }

  const saving = createAccount.isPending || updateAccount.isPending;

  return (
    <ScrollView className="flex-1 bg-white" contentContainerClassName="gap-4 p-4">
      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Název</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.name}
          onChangeText={(value) => setForm((current) => ({ ...current, name: value }))}
        />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Typ</Text>
        <ChoiceRow options={TYPE_OPTIONS} value={form.type} onChange={(value) => setForm((current) => ({ ...current, type: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Poskytovatel</Text>
        <ChoiceRow options={PROVIDER_OPTIONS} value={form.provider} onChange={(value) => setForm((current) => ({ ...current, provider: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-medium text-neutral-500">Měna</Text>
        <TextInput
          className="rounded-lg border border-neutral-300 px-3 py-2"
          value={form.currency}
          autoCapitalize="characters"
          maxLength={3}
          onChangeText={(value) => setForm((current) => ({ ...current, currency: value }))}
        />
      </View>

      <View className="flex-row items-center justify-between">
        <Text className="text-sm font-medium text-neutral-500">Součást čistého jmění</Text>
        <Switch
          value={form.includeInNetWorth}
          onValueChange={(value) => setForm((current) => ({ ...current, includeInNetWorth: value }))}
        />
      </View>

      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}

      <Pressable onPress={handleSave} disabled={saving} className="items-center rounded-lg bg-neutral-900 py-3">
        <Text className="font-medium text-white">{saving ? 'Ukládám…' : 'Uložit'}</Text>
      </Pressable>

      {!isNew && account ? (
        <>
          <Pressable
            onPress={() => setArchived.mutate({ id: account.id, isArchived: !account.isArchived }, { onSuccess: () => router.back() })}
            disabled={setArchived.isPending}
            className="items-center rounded-lg border border-neutral-300 py-3"
          >
            <Text className="font-medium text-neutral-900">{account.isArchived ? 'Obnovit z archivu' : 'Archivovat'}</Text>
          </Pressable>

          <Pressable onPress={handleDelete} className="items-center rounded-lg border border-red-200 py-3">
            <Text className="font-medium text-red-600">Smazat účet</Text>
          </Pressable>

          {account.type === 'CREDIT' ? (
            <View className="gap-3 border-t border-neutral-100 pt-4">
              <Text className="text-sm font-medium text-neutral-500">Kreditní karta</Text>

              {account.creditDetails ? (
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  <Text className="text-sm text-neutral-700">Limit: {formatMoney(account.creditDetails.limit, account.currency)}</Text>
                  <Text className="text-sm text-neutral-700">Dluh: {formatMoney(account.creditDetails.debt, account.currency)}</Text>
                  <Text className="text-sm text-neutral-700">Volná kapacita: {formatMoney(account.creditDetails.capacity, account.currency)}</Text>
                </View>
              ) : null}

              {creditMessage ? <Text className="text-sm text-red-600">{creditMessage}</Text> : null}

              {recordingDebt ? (
                <CreditDebtForm
                  currency={account.currency}
                  disabled={recordCreditDebt.isPending}
                  onCancel={() => setRecordingDebt(false)}
                  onSubmit={(values) => {
                    setCreditMessage(null);
                    recordCreditDebt.mutate(
                      { accountId: account.id, ...values },
                      {
                        onSuccess: () => setRecordingDebt(false),
                        onError: (mutationError) => setCreditMessage(mutationError instanceof Error ? mutationError.message : 'Dluh se nepodařilo uložit'),
                      },
                    );
                  }}
                />
              ) : (
                <Pressable onPress={() => setRecordingDebt(true)} className="items-center rounded-lg border border-neutral-300 py-2.5">
                  <Text className="font-medium text-neutral-900">Zadat dluh</Text>
                </Pressable>
              )}

              {account.creditNeedsOpeningConfirmation ? (
                <Pressable
                  onPress={() =>
                    confirmCreditZeroStart.mutate(account.id, {
                      onError: (mutationError) => setCreditMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se potvrdit'),
                    })
                  }
                  disabled={confirmCreditZeroStart.isPending}
                  className="items-center rounded-lg border border-neutral-300 py-2.5"
                >
                  <Text className="font-medium text-neutral-900">{confirmCreditZeroStart.isPending ? 'Potvrzuji…' : 'Potvrdit nulový start'}</Text>
                </Pressable>
              ) : null}

              {account.creditDetails?.invalidCapacitySnapshot ? (
                <Pressable
                  onPress={() =>
                    clearCreditCapacitySnapshot.mutate(account.id, {
                      onError: (mutationError) => setCreditMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se odstranit'),
                    })
                  }
                  disabled={clearCreditCapacitySnapshot.isPending}
                  className="items-center rounded-lg py-2"
                >
                  <Text className="font-medium text-amber-700">{clearCreditCapacitySnapshot.isPending ? 'Odstraňuji…' : 'Odstranit chybný zůstatek'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
