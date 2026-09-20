import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, Switch, Text, TextInput, View, ActivityIndicator } from 'react-native';

import { useAccountsList, useCreateAccount, useDeleteAccount, useSetAccountArchived, useUpdateAccount } from '../../../../hooks/use-accounts';
import type { AccountInput, AccountProvider, AccountType } from '../../../../lib/response-types';

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

  const [form, setForm] = useState<AccountInput>(EMPTY_FORM);
  const [error, setError] = useState<string | null>(null);

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
            <Text className="text-xs text-neutral-400">
              Správa dluhu kreditní karty zatím není na mobilu k dispozici — použijte webovou appku.
            </Text>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
