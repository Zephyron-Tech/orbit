import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, RefreshControl, Text, View } from 'react-native';

import { useTransactionsList } from '../../../hooks/use-transactions';
import type { TransactionRow } from '../../../lib/response-types';

function TransactionListItem({ transaction, onPress }: { transaction: TransactionRow; onPress: () => void }): React.JSX.Element {
  const isExpense = transaction.amount.startsWith('-');

  return (
    <Pressable onPress={onPress} className="flex-row items-center justify-between border-b border-neutral-100 px-4 py-3">
      <View className="flex-1 pr-3">
        <Text className="font-medium text-neutral-900" numberOfLines={1}>
          {transaction.merchant}
        </Text>
        <Text className="text-xs text-neutral-500">
          {transaction.date} · {transaction.accountName}
        </Text>
      </View>
      <Text className={isExpense ? 'text-red-600' : 'text-emerald-600'}>
        {transaction.amount} {transaction.currency}
      </Text>
    </Pressable>
  );
}

export default function TransactionsListScreen(): React.JSX.Element {
  const router = useRouter();
  const [page, setPage] = useState(1);
  const { data, isPending, isError, error, refetch, isRefetching } = useTransactionsList({ page });

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

      <FlatList
        data={data.transactions}
        keyExtractor={(transaction) => transaction.id}
        renderItem={({ item }) => (
          <TransactionListItem transaction={item} onPress={() => router.push(`/(tabs)/transactions/${item.id}`)} />
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
