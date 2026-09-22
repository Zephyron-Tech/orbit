import { useRouter } from 'expo-router';
import { ArrowsClockwiseIcon, MagnifyingGlassIcon, TagIcon, XIcon } from 'phosphor-react-native';
import { useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { Button } from '../../../components/button';
import { ListSkeleton } from '../../../components/skeleton';
import { TextField } from '../../../components/text-field';
import {
  useApplyMerchantCategory,
  useBulkCategorize,
  useInfiniteTransactionsList,
  useMatchTransfers,
  type TransactionsListParams,
} from '../../../hooks/use-transactions';
import { useDismissUnmatchedTransfer } from '../../../hooks/use-net-worth';
import { formatMoney } from '../../../lib/format-money';
import type { MerchantCategoryRecommendation, TransactionRow } from '../../../lib/response-types';

function Chip({ label, active, onPress }: { label: string; active: boolean; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className={`mr-2 rounded-full border px-3 py-1.5 active:bg-surface-subtle ${active ? 'border-accent bg-accent-soft' : 'border-line bg-surface'}`}>
      <Text className={`font-sans-medium text-sm ${active ? 'text-accent' : 'text-ink-muted'}`}>{label}</Text>
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
      className="flex-row items-center justify-between border-b border-line px-4 py-3 active:bg-surface-subtle"
    >
      {selectMode ? (
        <View className={`mr-3 size-5 items-center justify-center rounded border ${selected ? 'border-accent bg-accent' : 'border-line-strong'}`}>
          {selected ? <Text className="text-xs text-accent-foreground">✓</Text> : null}
        </View>
      ) : null}
      <View className="flex-1 pr-3">
        <Text className="font-sans-semibold text-ink" numberOfLines={1}>
          {transaction.merchant}
        </Text>
        <Text className="text-xs text-ink-muted">
          {transaction.date} · {transaction.accountName}
        </Text>
        {isUnmatchedTransfer && onDismissTransfer ? (
          <Pressable onPress={onDismissTransfer} disabled={dismissPending} className="mt-1 self-start rounded bg-warning-soft px-2 py-0.5">
            <Text className="text-xs text-warning">{dismissPending ? 'Skrývám…' : 'Skrýt nespárovaný převod'}</Text>
          </Pressable>
        ) : null}
      </View>
      <Text className={`font-sans-semibold ${isExpense ? 'text-ink' : 'text-positive'}`}>
        {formatMoney(transaction.amount, transaction.currency)}
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
    <View className="m-4 gap-2 rounded-lg border border-accent/25 bg-accent-soft p-3">
      <Text className="text-sm text-ink">
        {recommendation.targetIds.length}× "{recommendation.merchantLabel}" — přiřadit kategorii "{recommendation.categoryName}"?
      </Text>
      {error ? <Text className="text-xs text-critical">{error}</Text> : null}
      <View className="flex-row gap-2">
        <Button variant="primary" size="chip" loading={applyMerchantCategory.isPending} onPress={handleApply}>
          Přiřadit
        </Button>
        <Button variant="secondary" size="chip" onPress={onDismiss}>
          Zavřít
        </Button>
      </View>
    </View>
  );
}

export default function TransactionsListScreen(): React.JSX.Element {
  const router = useRouter();
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

  const params: Omit<TransactionsListParams, 'page'> = {
    accountId,
    categoryId,
    uncategorized,
    shared,
    q: q.trim() || undefined,
    sort,
    direction,
    transfer: transferOnly ? 'unmatched' : undefined,
  };
  const { data: infiniteData, isPending, isError, error, refetch, isRefetching, fetchNextPage, hasNextPage, isFetchingNextPage } =
    useInfiniteTransactionsList(params);
  // Every page shares the same period-wide aggregates (income/expenses/
  // balance/categories/accounts/recommendations) — only `transactions`
  // itself needs flattening across pages.
  const data = infiniteData?.pages[0]
    ? { ...infiniteData.pages[0], transactions: infiniteData.pages.flatMap((p) => p.transactions) }
    : undefined;
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

  if (isPending || !data) {
    return (
      <View className="flex-1 bg-canvas">
        <ListSkeleton rows={6} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Transakce se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-canvas">
      <View className="border-b border-line bg-surface px-4 py-3">
        <View className="mb-2 flex-row items-center gap-2 rounded-lg border border-line bg-canvas px-3">
          <MagnifyingGlassIcon color="#5d6c68" size={16} weight="regular" />
          <TextField
            className="flex-1 border-0 bg-transparent px-0 py-2"
            placeholder="Hledat (protistrana, poznámka)…"
            value={q}
            onChangeText={(text) => { setQ(text); }}
            returnKeyType="search"
          />
        </View>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          <Chip label="Všechny účty" active={!accountId} onPress={() => { setAccountId(undefined); }} />
          {data.accounts.map((account) => (
            <Chip key={account.id} label={account.name} active={accountId === account.id} onPress={() => { setAccountId(account.id); }} />
          ))}
        </ScrollView>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} className="mb-2">
          <Chip label="Všechny kategorie" active={!categoryId && !uncategorized} onPress={() => { setCategoryId(undefined); setUncategorized(false); }} />
          <Chip label="Bez kategorie" active={uncategorized} onPress={() => { setUncategorized((v) => !v); setCategoryId(undefined); }} />
          {data.categories.map((category) => (
            <Chip
              key={category.id}
              label={category.name}
              active={categoryId === category.id}
              onPress={() => { setCategoryId(category.id); setUncategorized(false); }}
            />
          ))}
        </ScrollView>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip label="Sdílené" active={shared} onPress={() => { setShared((v) => !v); }} />
          <Chip label="Nespárované převody" active={transferOnly} onPress={() => { setTransferOnly((v) => !v); }} />
          <Chip label={sort === 'date' ? 'Řadit: datum' : 'Řadit: částka'} active={false} onPress={() => setSort((s) => (s === 'date' ? 'amount' : 'date'))} />
          <Chip label={direction === 'desc' ? '↓' : '↑'} active={false} onPress={() => setDirection((d) => (d === 'desc' ? 'asc' : 'desc'))} />
          <Pressable onPress={() => router.push('/(tabs)/transactions/categories')} className="ml-auto flex-row items-center gap-1 rounded-full border border-line bg-surface px-3 py-1.5 active:bg-surface-subtle">
            <TagIcon color="#5d6c68" size={14} weight="regular" />
            <Text className="text-ink-muted">Kategorie</Text>
          </Pressable>
        </View>
        <Button variant="secondary" icon={ArrowsClockwiseIcon} loading={matchTransfers.isPending} onPress={() => matchTransfers.mutate()} className="mt-2">
          Spárovat převody
        </Button>
      </View>

      {activeRecommendation && data.period.from && data.period.to ? (
        <RecommendationBanner
          recommendation={activeRecommendation}
          from={data.period.from}
          to={data.period.to}
          onDismiss={() => setDismissedRecommendations((current) => new Set(current).add(activeRecommendation.merchantKey))}
        />
      ) : null}

      <View className="flex-row justify-around border-b border-line bg-surface px-4 py-3">
        <View className="items-center">
          <Text className="text-xs text-ink-muted">Příjmy</Text>
          <Text className="font-sans-semibold text-positive">{formatMoney(data.income)}</Text>
        </View>
        <View className="items-center">
          <Text className="text-xs text-ink-muted">Výdaje</Text>
          <Text className="font-sans-semibold text-ink">{formatMoney(data.expenses)}</Text>
        </View>
        <View className="items-center">
          <Text className="text-xs text-ink-muted">Bilance</Text>
          <Text className="font-sans-semibold text-ink">{formatMoney(data.balance)}</Text>
        </View>
      </View>

      {selectMode ? (
        <View className="flex-row flex-wrap items-center gap-2 border-b border-line bg-surface-subtle px-4 py-2">
          <Text className="text-sm text-ink-muted">Vybráno: {selectedIds.size}</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} className="flex-1">
            {data.categories.map((category) => (
              <Pressable
                key={category.id}
                onPress={() => handleBulkCategorize(category.id)}
                disabled={selectedIds.size === 0 || bulkCategorize.isPending}
                className="mr-2 rounded-full border border-line bg-surface px-3 py-1 active:bg-surface-subtle"
              >
                <Text className="text-sm text-ink-muted">{category.name}</Text>
              </Pressable>
            ))}
          </ScrollView>
          <Pressable onPress={() => { setSelectMode(false); setSelectedIds(new Set()); }} className="flex-row items-center gap-1">
            <XIcon color="#5d6c68" size={14} weight="regular" />
            <Text className="text-sm text-ink-muted">Zrušit</Text>
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
        refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
        onEndReached={() => {
          if (hasNextPage && !isFetchingNextPage) void fetchNextPage();
        }}
        onEndReachedThreshold={0.4}
        ListEmptyComponent={
          <View className="items-center py-10">
            <Text className="text-ink-muted">Žádné transakce v tomto období.</Text>
          </View>
        }
        ListFooterComponent={
          isFetchingNextPage ? (
            <View className="items-center py-4">
              <ActivityIndicator color="#17647c" />
            </View>
          ) : null
        }
      />
    </View>
  );
}
