import { useLocalSearchParams, useRouter } from 'expo-router';
import { CreditCardIcon, WarningCircleIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../../components/button';
import { Switch } from '../../../../components/switch';
import { TextField } from '../../../../components/text-field';
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
import { formatMoney } from '../../../../lib/format-money';
import type { AccountInput, AccountProvider, AccountType } from '../../../../lib/response-types';

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
    <View className="gap-3 rounded-lg border border-line bg-surface-subtle p-3">
      <Text className="text-sm text-ink-muted">Zadejte kladný aktuální dluh. Uloží se jako záporný zůstatek účtu.</Text>
      <View>
        <Text className="mb-1 text-xs font-sans-medium text-ink-muted">Aktuální dluh ({currency})</Text>
        <TextField variant="money" value={debt} onChangeText={setDebt} placeholder="5000" returnKeyType="done" />
      </View>
      <View>
        <Text className="mb-1 text-xs font-sans-medium text-ink-muted">Platný k datu (RRRR-MM-DD)</Text>
        <TextField value={asOf} onChangeText={setAsOf} placeholder="2026-01-01" returnKeyType="done" />
      </View>
      <View className="flex-row gap-2">
        <Button variant="secondary" className="flex-1" disabled={disabled} onPress={onCancel}>
          Zrušit
        </Button>
        <Button variant="primary" className="flex-1" loading={disabled} disabled={!debt} onPress={() => onSubmit({ debt, asOf })}>
          Uložit dluh
        </Button>
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
          className={`rounded-full border px-3 py-1.5 active:opacity-80 ${value === option.value ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
        >
          <Text className={value === option.value ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{option.label}</Text>
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
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">Účet nenalezen</Text>
      </View>
    );
  }

  if (!isNew && !account) {
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
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-4 p-4">
      <View>
        <Text className="mb-2 text-sm font-sans-medium text-ink-muted">Název</Text>
        <TextField value={form.name} onChangeText={(value) => setForm((current) => ({ ...current, name: value }))} returnKeyType="done" />
      </View>

      <View>
        <Text className="mb-2 text-sm font-sans-medium text-ink-muted">Typ</Text>
        <ChoiceRow options={TYPE_OPTIONS} value={form.type} onChange={(value) => setForm((current) => ({ ...current, type: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-sans-medium text-ink-muted">Poskytovatel</Text>
        <ChoiceRow options={PROVIDER_OPTIONS} value={form.provider} onChange={(value) => setForm((current) => ({ ...current, provider: value }))} />
      </View>

      <View>
        <Text className="mb-2 text-sm font-sans-medium text-ink-muted">Měna</Text>
        <TextField
          value={form.currency}
          autoCapitalize="characters"
          maxLength={3}
          onChangeText={(value) => setForm((current) => ({ ...current, currency: value }))}
          returnKeyType="done"
        />
      </View>

      <View className="flex-row items-center justify-between rounded-lg border border-line bg-surface-subtle px-3 py-3">
        <Text className="text-sm font-sans-medium text-ink">Součást čistého jmění</Text>
        <Switch
          value={form.includeInNetWorth}
          onValueChange={(value) => setForm((current) => ({ ...current, includeInNetWorth: value }))}
        />
      </View>

      {error ? <Text className="text-sm text-critical">{error}</Text> : null}

      <Button variant="primary" loading={saving} onPress={handleSave}>
        Uložit
      </Button>

      {!isNew && account ? (
        <>
          <Button
            variant="secondary"
            loading={setArchived.isPending}
            onPress={() => setArchived.mutate({ id: account.id, isArchived: !account.isArchived }, { onSuccess: () => router.back() })}
          >
            {account.isArchived ? 'Obnovit z archivu' : 'Archivovat'}
          </Button>

          <Button variant="destructive" onPress={handleDelete}>
            Smazat účet
          </Button>

          {account.type === 'CREDIT' ? (
            <View className="gap-3 border-t border-line pt-4">
              <View className="flex-row items-center gap-2">
                <CreditCardIcon color="#5d6c68" size={16} weight="regular" />
                <Text className="text-sm font-sans-medium text-ink-muted">Kreditní karta</Text>
              </View>

              {account.creditDetails ? (
                <View className="flex-row flex-wrap gap-x-4 gap-y-1">
                  <Text className="text-sm text-ink-muted">Limit: {formatMoney(account.creditDetails.limit, account.currency)}</Text>
                  <Text className="text-sm text-ink-muted">Dluh: {formatMoney(account.creditDetails.debt, account.currency)}</Text>
                  <Text className="text-sm text-ink-muted">Volná kapacita: {formatMoney(account.creditDetails.capacity, account.currency)}</Text>
                </View>
              ) : null}

              {account.creditDetails?.invalidCapacitySnapshot ? (
                <View className="flex-row items-start gap-2 rounded-lg bg-warning-soft p-3">
                  <WarningCircleIcon color="#8a5a13" size={16} weight="regular" />
                  <Text className="flex-1 text-xs text-warning">
                    Kladný ruční zůstatek se jako dostupný limit nepoužívá. Dluh je dopočítaný z importovaných karetních plateb.
                  </Text>
                </View>
              ) : null}

              {creditMessage ? <Text className="text-sm text-critical">{creditMessage}</Text> : null}

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
                <Button variant="secondary" onPress={() => setRecordingDebt(true)}>
                  Zadat dluh
                </Button>
              )}

              {account.creditNeedsOpeningConfirmation ? (
                <Button
                  variant="secondary"
                  loading={confirmCreditZeroStart.isPending}
                  onPress={() =>
                    confirmCreditZeroStart.mutate(account.id, {
                      onError: (mutationError) => setCreditMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se potvrdit'),
                    })
                  }
                >
                  Potvrdit nulový start
                </Button>
              ) : null}

              {account.creditDetails?.invalidCapacitySnapshot ? (
                <Pressable
                  onPress={() =>
                    clearCreditCapacitySnapshot.mutate(account.id, {
                      onError: (mutationError) => setCreditMessage(mutationError instanceof Error ? mutationError.message : 'Nepodařilo se odstranit'),
                    })
                  }
                  disabled={clearCreditCapacitySnapshot.isPending}
                  className="items-center rounded-lg py-2 active:opacity-70"
                >
                  <Text className="font-sans-medium text-warning">{clearCreditCapacitySnapshot.isPending ? 'Odstraňuji…' : 'Odstranit chybný zůstatek'}</Text>
                </Pressable>
              ) : null}
            </View>
          ) : null}
        </>
      ) : null}
    </ScrollView>
  );
}
