import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlusIcon, XIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../components/button';
import { Switch } from '../../../components/switch';
import { TextField } from '../../../components/text-field';
import {
  SPLIT_MAX_LINES,
  SPLIT_MIN_LINES,
  useMergeSplit,
  useSplitTransaction,
  useTransaction,
  useTransactionsList,
  useUpdateTransaction,
} from '../../../hooks/use-transactions';
import type { SplitLineInput } from '../../../hooks/use-transactions';
import { formatMoney } from '../../../lib/format-money';

/** Dynamic add/remove-line split editor, 2–20 lines (SPLIT_MIN_LINES/SPLIT_MAX_LINES mirror the API's own bound). */
function SplitPanel({ transactionId, totalAmount, onDone }: { transactionId: string; totalAmount: string; onDone: () => void }): React.JSX.Element {
  const splitTransaction = useSplitTransaction();
  const [amounts, setAmounts] = useState<string[]>(['', '']);
  const [error, setError] = useState<string | null>(null);

  function addLine(): void {
    setAmounts((current) => (current.length >= SPLIT_MAX_LINES ? current : [...current, '']));
  }

  function removeLine(index: number): void {
    setAmounts((current) => (current.length <= SPLIT_MIN_LINES ? current : current.filter((_, i) => i !== index)));
  }

  function updateAmount(index: number, value: string): void {
    setAmounts((current) => current.map((amount, i) => (i === index ? value : amount)));
  }

  function handleSplit(): void {
    setError(null);
    const lines: SplitLineInput[] = amounts.map((amount) => ({ amount, categoryId: null, isShared: false, myShareRatio: null, notes: null }));
    splitTransaction.mutate(
      { parentId: transactionId, lines },
      {
        onSuccess: onDone,
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Rozdělení se nezdařilo'),
      },
    );
  }

  return (
    <View className="mt-4 gap-3 rounded-lg border border-line bg-surface p-4">
      <Text className="font-sans-medium text-sm text-ink-muted">Rozdělit na {amounts.length} částí (celkem musí sedět na {totalAmount})</Text>
      {amounts.map((amount, index) => (
        <View key={index} className="flex-row items-center gap-2">
          <TextField
            variant="money"
            className="flex-1"
            placeholder={`Částka ${index + 1}`}
            value={amount}
            onChangeText={(value) => updateAmount(index, value)}
            returnKeyType="done"
          />
          {amounts.length > SPLIT_MIN_LINES ? (
            <Pressable onPress={() => removeLine(index)} hitSlop={8} className="rounded-lg border border-line px-3 py-2 active:bg-surface-subtle">
              <XIcon color="#5d6c68" size={16} weight="regular" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {amounts.length < SPLIT_MAX_LINES ? (
        <Button variant="ghost" icon={PlusIcon} onPress={addLine} className="border border-dashed border-line-strong">
          Přidat řádek
        </Button>
      ) : null}
      {error ? <Text className="text-sm text-critical">{error}</Text> : null}
      <Button variant="primary" loading={splitTransaction.isPending} onPress={handleSplit}>
        Rozdělit
      </Button>
    </View>
  );
}

export default function TransactionDetailScreen(): React.JSX.Element {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const { data: transaction, isPending, isError } = useTransaction(id);
  // Categories aren't returned by the single-transaction read (only the
  // list endpoint includes them) — reused here rather than adding a
  // dedicated categories endpoint for this pass.
  const { data: listData } = useTransactionsList({});
  const updateTransaction = useUpdateTransaction();
  const mergeSplit = useMergeSplit();

  const [categoryId, setCategoryId] = useState<string | null>(null);
  const [notes, setNotes] = useState('');
  const [isShared, setIsShared] = useState(false);
  const [paidBy, setPaidBy] = useState<'ME' | 'PARTNER'>('ME');
  const [showSplit, setShowSplit] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!transaction) return;
    setCategoryId(transaction.categoryId);
    setNotes(transaction.notes ?? '');
    setIsShared(transaction.isShared);
    setPaidBy(transaction.paidBy);
  }, [transaction]);

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError || !transaction) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">Transakci se nepodařilo načíst</Text>
      </View>
    );
  }

  const isExpense = transaction.amount.startsWith('-');

  function handleSave(): void {
    if (!transaction) return;
    setSaveError(null);
    setSaved(false);
    updateTransaction.mutate(
      {
        id: transaction.id,
        categoryId,
        bucketId: transaction.bucketId,
        recurringExpenseId: transaction.recurringExpenseId,
        kind: transaction.kind === 'SPLIT_PARENT' ? 'NORMAL' : transaction.kind,
        isShared,
        paidBy,
        myShareRatio: isShared ? (transaction.myShareRatio ?? 0.5) : null,
        notes: notes.trim() || null,
      },
      {
        onSuccess: () => setSaved(true),
        onError: (error) => setSaveError(error instanceof Error ? error.message : 'Nepodařilo se uložit transakci'),
      },
    );
  }

  return (
    <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="p-4">
      <Text className="font-sans-semibold text-xl text-ink">{transaction.merchant}</Text>
      <Text className="mt-1 text-sm text-ink-muted">
        {transaction.date} · {transaction.accountName}
      </Text>
      <Text className={`font-sans-semibold mt-2 text-2xl ${isExpense ? 'text-ink' : 'text-positive'}`}>
        {formatMoney(transaction.amount, transaction.currency)}
      </Text>

      {transaction.isSettled ? (
        <Text className="mt-3 text-sm text-warning">Tato transakce je součástí uzavřeného vyrovnání a nelze ji upravit.</Text>
      ) : (
        <View className="mt-4 gap-4">
          <View>
            <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Kategorie</Text>
            <View className="flex-row flex-wrap gap-2">
              {(listData?.categories ?? []).map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => setCategoryId(category.id)}
                  className={`rounded-full border px-3 py-1.5 active:bg-surface-subtle ${categoryId === category.id ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                >
                  <Text className={categoryId === category.id ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{category.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="font-sans-medium text-sm text-ink-muted">Sdílená platba</Text>
            <Switch value={isShared} onValueChange={setIsShared} />
          </View>

          <View>
            <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Zaplatil(a)</Text>
            <View className="flex-row gap-2">
              {(['ME', 'PARTNER'] as const).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setPaidBy(option)}
                  className={`rounded-full border px-3 py-1.5 active:bg-surface-subtle ${paidBy === option ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}
                >
                  <Text className={paidBy === option ? 'font-sans-medium text-accent' : 'text-ink-muted'}>{option === 'ME' ? 'Já' : 'Partner'}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text className="font-sans-medium mb-2 text-sm text-ink-muted">Poznámka</Text>
            <TextField
              multiline
              value={notes}
              onChangeText={setNotes}
              returnKeyType="done"
              blurOnSubmit
            />
          </View>

          {saveError ? <Text className="text-sm text-critical">{saveError}</Text> : null}
          {saved ? <Text className="text-sm text-positive">Uloženo.</Text> : null}

          <Button variant="primary" loading={updateTransaction.isPending} onPress={handleSave}>
            Uložit
          </Button>

          {transaction.kind === 'SPLIT_PARENT' ? (
            <Button variant="secondary" loading={mergeSplit.isPending} onPress={() => mergeSplit.mutate(transaction.id, { onSuccess: () => router.back() })}>
              Zrušit rozdělení
            </Button>
          ) : (
            <Button variant="secondary" onPress={() => setShowSplit((current) => !current)}>
              {showSplit ? 'Skrýt rozdělení' : 'Rozdělit transakci'}
            </Button>
          )}

          {showSplit ? <SplitPanel transactionId={transaction.id} totalAmount={transaction.amount} onDone={() => router.back()} /> : null}
        </View>
      )}
    </ScrollView>
    </KeyboardAvoidingView>
  );
}
