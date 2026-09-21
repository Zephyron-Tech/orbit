import { useRouter } from 'expo-router';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native';

import {
  useApplyMerchantCategory,
  useBulkCategorize,
  useMatchTransfers,
  useTransactionsList,
  type TransactionsListParams,
} from '../../../hooks/use-transactions';
import { useDismissUnmatchedTransfer } from '../../../hooks/use-net-worth';
import type { MerchantCategoryRecommendation, TransactionRow } from '../../../lib/response-types';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className={`mr-2 rounded-full border px-3 py-1.5 ${active ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}>
      <Text className={active ? 'text-white' : 'text-neutral-700'}>{label}</Text>
    </Pressable>
  );
}

function TransactionListItem({
  transaction,
  onPress,
  selectMode,
  selected,
  onToggleSelect,
  onDismissTransfer,
  dismissPending,
}: {
  transaction: TransactionRow;
  onPress: () => void;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDismissTransfer?: () => void;
  dismissPending: boolean;
}): React.JSX.Element {
  const isExpense = transaction.amount.startsWith('-');
  const isUnmatchedTransfer = (transaction.kind === 'INTERNAL_TRANSFER' || transaction.kind === 'PENDING_TRANSFER') && transaction.transferCounterpartyAccount === null;

  return (
    <Pressable
      onPress={selectMode ? onToggleSelect : onPress}
      onLongPress={onToggleSelect}
      className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3"
    >
      {selectMode ? (
        <View className={`mr-3 size-5 items-center justify-center rounded border ${selected ? 'border-neutral-900 bg-neutral-900' : 'border-neutral-300'}`}>
          {selected ? <Text className="text-xs text-white">✓</Text> : null}
        </View>
      ) : null}
      <View className="flex-1 pr-3">
        <Text className="font-medium text-neutral-900" numberOfLines={1}>
          {transaction.merchant}
        </Text>
        <Text className="text-xs text-neutral-500">
          {transaction.date} · {transaction.accountName}
        </Text>
        {isUnmatchedTransfer && onDismissTransfer ? (
          <Pressable onPress={onDismissTransfer} disabled={dismissPending} className="mt-1 self-start rounded bg-amber-50 px-2 py-0.5">
            <Text className="text-xs text-amber-700">{dismissPending ? 'Skrývám…' : 'Skrýt nespárovaný převod'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className={isExpense ? 'text-red-600' : 'text-emerald-600'}>
        {transaction.amount} {transaction.currency}
      </Text>
    </Pressable>
  );
}

function RecommendationBanner({
  recommendation,
  from,
  to,
  onDismiss,
}: {
  recommendation: MerchantCategoryRecommendation;
  from: string;
  to: string;
  onDismiss: () => void;
}): React.JSX.Element {
  const applyMerchantCategory = useApplyMerchantCategory();
  const [error, setError] = useState<string | null>(null);

  function handleApply(): void {
    setError(null);
    applyMerchantCategory.mutate(
      { accountId: recommendation.accountId, categoryId: recommendation.categoryId, merchantKey: recommendation.merchantKey, from, to },
      { onSuccess: onDismiss, onError: (e) => setError(e instanceof Error ? e.message : 'Nepodařilo se přiřadit kategorii') },
    );
  }

  return (
    <View className="m-4 gap-2 rounded-xl border border-blue-200 bg-blue-50 p-3">
      <Text className="text-sm text-blue-900">
        {recommendation.targetIds.length}× "{recommendation.merchantLabel}" — přiřadit kategorii "{recommendation.categoryName}"?
      </Text>
      {error ? <Text className="text-xs text-red-600">{error}</Text> : null}
      <View className="flex-row gap-2">
        <Pressable onPress={handleApply} disabled={applyMerchantCategory.isPending} className="rounded-lg bg-blue-900 px-3 py-1.5">
          <Text className="text-sm font-medium text-white">{applyMerchantCategory.isPending ? 'Přiřazuji…' : 'Přiřadit'}</Text>
        </Pressable>
        <Pressable onPress={onDismiss} className="rounded-lg border border-blue-300 px-3 py-1.5">
          <Text className="text-sm text-blue-900">Zavřít</Text>
        </Pressable>
      </View>
    </View>
  );
}

export default function TransactionsListScreen(): React.JSX.Element {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const [accountId, setAccountId] = useState<string | undefined>(undefined);
  const [categoryId, setCategoryId] = useState<string | undefined>(undefined);
  const [uncategorized, setUncategorized] = useState(false);
  const [shared, setShared] = useState(false);
  const [transferOnly, setTransferOnly] = useState(false);
  const [q, setQ] = useState('');
  const [sort, setSort] = useState<'date' | 'amount'>('date');
  const [direction, setDirection] = useState<'asc' | 'desc'>('desc');
  const [selectMode, setSelectMode] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [dismissedRecommendations, setDismissedRecommendations] = useState<Set<string>>(new Set());

  const params: TransactionsListParams = {
    page,
    accountId,
    categoryId,
    uncategorized,
    shared,
    q: q.trim() || undefined,
    sort,
    direction,
    transfer: transferOnly ? 'unmatched' : undefined,
  };
  const { data, isPending, isError, error, refetch, isRefetching } = useTransactionsList(params);
  const bulkCategorize = useBulkCategorize();
  const matchTransfers = useMatchTransfers();
  const dismissUnmatchedTransfer = useDismissUnmatchedTransfer();

  const activeRecommendation = useMemo(
    () => data?.recommendations.find((r) => !dismissedRecommendations.has(r.merchantKey)),
    [data?.recommendations, dismissedRecommendations],
  );

  function toggleSelect(id: string): void {
    setSelectMode(true);
    setSelectedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function handleBulkCategorize(targetCategoryId: string | null): void {
    bulkCategorize.mutate(
      { ids: Array.from(selectedIds), categoryId: targetCategoryId },
      { onSuccess: () => { setSelectedIds(new Set()); setSelectMode(false); } },
    );
  }

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Transakce se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-white">
      <View className="border-b border-neutral-100 px-4 py-3">
        <TextInput
          className="mb-2 rounded-lg border border-neutral-300 px-3 py-2"
          placeholder="Hledat (protistrana, poznámka)…"
          value={q}
          onChangeText={(text) => { setQ(text); setPage(1); }}
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          <Chip label="Všechny účty" active={!accountId} onPress={() => { setAccountId(undefined); setPage(1); }} />
          {data.accounts.map((account) => (
            <Chip key={account.id} label={account.name} active={accountId === account.id} onPress={() => { setAccountId(account.id); setPage(1); }} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          <Chip label="Všechny kategorie" active={!categoryId && !uncategorized} onPress={() => { setCategoryId(undefined); setUncategorized(false); setPage(1); }} />
          <Chip label="Bez kategorie" active={uncategorized} onPress={() => { setUncategorized((v) => !v); setCategoryId(undefined); setPage(1); }} />
          {data.categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              active={categoryId === category.id}
              onPress={() => { setCategoryId(category.id); setUncategorized(false); setPage(1); }}
            />
          ))}
        </ScrollView>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip label="Sdílené" active={shared} onPress={() => { setShared((v) => !v); setPage(1); }} />
          <Chip label="Nespárované převody" active={transferOnly} onPress={() => { setTransferOnly((v) => !v); setPage(1); }} />
          <Chip label={sort === 'date' ? 'Řadit: datum' : 'Řadit: částka'} active={false} onPress={() => setSort((s) => (s === 'date' ? 'amount' : 'date'))} />
          <Chip label={direction === 'desc' ? '↓' : '↑'} active={false} onPress={() => setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))} />
          <Pressable onPress={() => router.push('/(tabs)/transactions/categories')} className="ml-auto rounded-full border border-neutral-300 px-3 py-1.5">
            <Text className="text-neutral-700">Kategorie</Text>
          </Pressable>
        </View>
        <Pressable
          onPress={() => matchTransfers.mutate()}
          disabled={matchTransfers.isPending}
          className="mt-2 items-center rounded-lg border border-neutral-300 py-2"
        >
          <Text className="text-neutral-700">
            {matchTransfers.isPending ? 'Páruji…' : 'Spárovat převody'}
          </Text>
        </Pressable>
      </View>

      {activeRecommendation && data.period.from && data.period.to ? (
        <RecommendationBanner
          recommendation={activeRecommendation}
          from={data.period.from}
          to={data.period.to}
          onDismiss={() => setDismissedRecommendations((current) => new Set(current).add(activeRecommendation.merchantKey))}
        />
      ) : null}

      <View className="flex-row justify-around border-b border-neutral-100 px-4 py-3">
        <View className="items-center">
          <Text className="text-xs text-neutral-500">Příjmy</Text>
          <Text className="text-emerald-600">{data.income} Kč</Text>
        </View>
        <View className="items-center">
          <Text className="text-xs text-neutral-500">Výdaje</Text>
          <Text className="text-red-600">{data.expenses} Kč</Text>
        </View>
        <View className="items-center">
          <Text className="text-xs text-neutral-500">Bilance</Text>
          <Text className="text-neutral-900">{data.balance} Kč</Text>
        </View>
      </View>

      {selectMode ? (
        <View className="flex-row flex-wrap items-center gap-2 border-b border-neutral-100 bg-neutral-50 px-4 py-2">
          <Text className="text-sm text-neutral-600">Vybráno: {selectedIds.size}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
            {data.categories.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => handleBulkCategorize(category.id)}
                disabled={selectedIds.size === 0 || bulkCategorize.isPending}
                className="mr-2 rounded-full border border-neutral-300 px-3 py-1"
              >
                <Text className="text-sm text-neutral-700">{category.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => { setSelectMode(false); setSelectedIds(new Set()); }}>
            <Text className="text-sm text-neutral-500">Zrušit</Text>
          </Pressable>
        </View>
      ) : null}

      <FlatList
        data={data.transactions}
        keyExtractor={(transaction) => transaction.id}
        renderItem={({ item }) => (
          <TransactionListItem
            transaction={item}
            onPress={() => router.push(`/(tabs)/transactions/${item.id}`)}
            selectMode={selectMode}
            selected={selectedIds.has(item.id)}
            onToggleSelect={() => toggleSelect(item.id)}
            onDismissTransfer={transferOnly ? () => dismissUnmatchedTransfer.mutate(item.id) : undefined}
            dismissPending={dismissUnmatchedTransfer.isPending}
          />
        )}
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
        ListEmptyComponent={
          <View className="items-center py-10">
            <Text className="text-neutral-500">Žádné transakce v tomto období.</Text>
          </View>
        }
      />

      {data.totalPages > 1 ? (
        <View className="flex-row items-center justify-between border-t border-neutral-100 px-4 py-3">
          <Pressable
            onPress={() => setPage((current) => Math.max(1, current - 1))}
            disabled={data.page <= 1}
            className="rounded-md bg-neutral-100 px-3 py-1.5 disabled:opacity-40"
          >
            <Text>Předchozí</Text>
          </Pressable>
          <Text className="text-neutral-500">
            {data.page} / {data.totalPages}
          </Text>
          <Pressable
            onPress={() => setPage((current) => Math.min(data.totalPages, current + 1))}
            disabled={data.page >= data.totalPages}
            className="rounded-md bg-neutral-100 px-3 py-1.5 disabled:opacity-40"
          >
            <Text>Další</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
