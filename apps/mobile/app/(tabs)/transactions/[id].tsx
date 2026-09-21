import { useLocalSearchParams, useRouter } from 'expo-router';
import { PlusIcon, XIcon } from 'phosphor-react-native';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

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
          <TextInput
            className="flex-1 rounded-lg border border-line px-3 py-2 text-ink"
            placeholder={`Částka ${index + 1}`}
            placeholderTextColor="#667570"
            keyboardType="numbers-and-punctuation"
            value={amount}
            onChangeText={(value) => updateAmount(index, value)}
          />
          {amounts.length > SPLIT_MIN_LINES ? (
            <Pressable onPress={() => removeLine(index)} className="rounded-lg border border-line px-3 py-2 active:bg-surface-subtle">
              <XIcon color="#5d6c68" size={16} weight="regular" />
            </Pressable>
          ) : null}
        </View>
      ))}
      {amounts.length < SPLIT_MAX_LINES ? (
        <Pressable onPress={addLine} className="flex-row items-center justify-center gap-1 rounded-lg border border-dashed border-line-strong py-2 active:bg-surface-subtle">
          <PlusIcon color="#5d6c68" size={14} weight="regular" />
          <Text className="text-ink-muted">Přidat řádek</Text>
        </Pressable>
      ) : null}
      {error ? <Text className="text-sm text-critical">{error}</Text> : null}
      <Pressable onPress={handleSplit} disabled={splitTransaction.isPending} className="items-center rounded-lg bg-accent py-2.5 active:bg-accent-hover">
        <Text className="font-sans-medium text-accent-foreground">{splitTransaction.isPending ? 'Ukládám…' : 'Rozdělit'}</Text>
      </Pressable>
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
            <Switch value={isShared} onValueChange={setIsShared} trackColor={{ true: '#17647c' }} />
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
            <TextInput
              className="rounded-lg border border-line px-3 py-2 text-ink"
              multiline
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {saveError ? <Text className="text-sm text-critical">{saveError}</Text> : null}
          {saved ? <Text className="text-sm text-positive">Uloženo.</Text> : null}

          <Pressable onPress={handleSave} disabled={updateTransaction.isPending} className="items-center rounded-lg bg-accent py-3 active:bg-accent-hover">
            <Text className="font-sans-medium text-accent-foreground">{updateTransaction.isPending ? 'Ukládám…' : 'Uložit'}</Text>
          </Pressable>

          {transaction.kind === 'SPLIT_PARENT' ? (
            <Pressable
              onPress={() => mergeSplit.mutate(transaction.id, { onSuccess: () => router.back() })}
              disabled={mergeSplit.isPending}
              className="items-center rounded-lg border border-line py-3 active:bg-surface-subtle"
            >
              <Text className="font-sans-medium text-ink">{mergeSplit.isPending ? 'Slučuji…' : 'Zrušit rozdělení'}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setShowSplit((current) => !current)} className="items-center rounded-lg border border-line py-3 active:bg-surface-subtle">
              <Text className="font-sans-medium text-ink">{showSplit ? 'Skrýt rozdělení' : 'Rozdělit transakci'}</Text>
            </Pressable>
          )}

          {showSplit ? <SplitPanel transactionId={transaction.id} totalAmount={transaction.amount} onDone={() => router.back()} /> : null}
        </View>
      )}
    </ScrollView>
  );
}
