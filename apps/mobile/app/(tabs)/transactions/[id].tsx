import { useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';

import { useMergeSplit, useSplitTransaction, useTransaction, useTransactionsList, useUpdateTransaction } from '../../../hooks/use-transactions';
import type { SplitLineInput } from '../../../hooks/use-transactions';

/** Two-line split only in this pass — the API supports up to 20, but a fixed
 * two-way split covers the common case and keeps this screen simple; a
 * full dynamic-line editor is a later enhancement, not this template. */
function SplitPanel({ transactionId, totalAmount, onDone }: { transactionId: string; totalAmount: string; onDone: () => void }): React.JSX.Element {
  const splitTransaction = useSplitTransaction();
  const [firstAmount, setFirstAmount] = useState('');
  const [secondAmount, setSecondAmount] = useState('');
  const [error, setError] = useState<string | null>(null);

  function handleSplit(): void {
    setError(null);
    const lines: SplitLineInput[] = [
      { amount: firstAmount, categoryId: null, isShared: false, myShareRatio: null, notes: null },
      { amount: secondAmount, categoryId: null, isShared: false, myShareRatio: null, notes: null },
    ];
    splitTransaction.mutate(
      { parentId: transactionId, lines },
      {
        onSuccess: onDone,
        onError: (mutationError) => setError(mutationError instanceof Error ? mutationError.message : 'Rozdělení se nezdařilo'),
      },
    );
  }

  return (
    <View className="mt-4 gap-3 rounded-xl border border-neutral-200 p-4">
      <Text className="text-sm font-medium text-neutral-500">Rozdělit na dvě části (celkem musí sedět na {totalAmount})</Text>
      <TextInput
        className="rounded-lg border border-neutral-300 px-3 py-2"
        placeholder="Částka 1"
        keyboardType="numbers-and-punctuation"
        value={firstAmount}
        onChangeText={setFirstAmount}
      />
      <TextInput
        className="rounded-lg border border-neutral-300 px-3 py-2"
        placeholder="Částka 2"
        keyboardType="numbers-and-punctuation"
        value={secondAmount}
        onChangeText={setSecondAmount}
      />
      {error ? <Text className="text-sm text-red-600">{error}</Text> : null}
      <Pressable onPress={handleSplit} disabled={splitTransaction.isPending} className="items-center rounded-lg bg-neutral-900 py-2.5">
        <Text className="font-medium text-white">{splitTransaction.isPending ? 'Ukládám…' : 'Rozdělit'}</Text>
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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError || !transaction) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">Transakci se nepodařilo načíst</Text>
      </View>
    );
  }

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
    <ScrollView className="flex-1 bg-white" contentContainerClassName="p-4">
      <Text className="text-xl font-semibold text-neutral-900">{transaction.merchant}</Text>
      <Text className="mt-1 text-sm text-neutral-500">
        {transaction.date} · {transaction.accountName}
      </Text>
      <Text className="mt-2 text-2xl font-semibold text-neutral-900">
        {transaction.amount} {transaction.currency}
      </Text>

      {transaction.isSettled ? (
        <Text className="mt-3 text-sm text-amber-700">Tato transakce je součástí uzavřeného vyrovnání a nelze ji upravit.</Text>
      ) : (
        <View className="mt-4 gap-4">
          <View>
            <Text className="mb-2 text-sm font-medium text-neutral-500">Kategorie</Text>
            <View className="flex-row flex-wrap gap-2">
              {(listData?.categories ?? []).map((category) => (
                <Pressable
                  key={category.id}
                  onPress={() => setCategoryId(category.id)}
                  className={`rounded-full border px-3 py-1.5 ${categoryId === category.id ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                >
                  <Text className={categoryId === category.id ? 'text-white' : 'text-neutral-700'}>{category.name}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-neutral-500">Sdílená platba</Text>
            <Switch value={isShared} onValueChange={setIsShared} />
          </View>

          <View>
            <Text className="mb-2 text-sm font-medium text-neutral-500">Zaplatil(a)</Text>
            <View className="flex-row gap-2">
              {(['ME', 'PARTNER'] as const).map((option) => (
                <Pressable
                  key={option}
                  onPress={() => setPaidBy(option)}
                  className={`rounded-full border px-3 py-1.5 ${paidBy === option ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}
                >
                  <Text className={paidBy === option ? 'text-white' : 'text-neutral-700'}>{option === 'ME' ? 'Já' : 'Partner'}</Text>
                </Pressable>
              ))}
            </View>
          </View>

          <View>
            <Text className="mb-2 text-sm font-medium text-neutral-500">Poznámka</Text>
            <TextInput
              className="rounded-lg border border-neutral-300 px-3 py-2"
              multiline
              value={notes}
              onChangeText={setNotes}
            />
          </View>

          {saveError ? <Text className="text-sm text-red-600">{saveError}</Text> : null}
          {saved ? <Text className="text-sm text-emerald-600">Uloženo.</Text> : null}

          <Pressable onPress={handleSave} disabled={updateTransaction.isPending} className="items-center rounded-lg bg-neutral-900 py-3">
            <Text className="font-medium text-white">{updateTransaction.isPending ? 'Ukládám…' : 'Uložit'}</Text>
          </Pressable>

          {transaction.kind === 'SPLIT_PARENT' ? (
            <Pressable
              onPress={() => mergeSplit.mutate(transaction.id, { onSuccess: () => router.back() })}
              disabled={mergeSplit.isPending}
              className="items-center rounded-lg border border-neutral-300 py-3"
            >
              <Text className="font-medium text-neutral-900">{mergeSplit.isPending ? 'Slučuji…' : 'Zrušit rozdělení'}</Text>
            </Pressable>
          ) : (
            <Pressable onPress={() => setShowSplit((current) => !current)} className="items-center rounded-lg border border-neutral-300 py-3">
              <Text className="font-medium text-neutral-900">{showSplit ? 'Skrýt rozdělení' : 'Rozdělit transakci'}</Text>
            </Pressable>
          )}

          {showSplit ? <SplitPanel transactionId={transaction.id} totalAmount={transaction.amount} onDone={() => router.back()} /> : null}
        </View>
      )}
    </ScrollView>
  );
}
