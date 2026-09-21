import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useAccountsList, useCreditRepaymentCandidates, useReorderAccount } from '../../../../hooks/use-accounts';
import type { AccountRow } from '../../../../lib/response-types';

const TYPE_LABELS: Record<AccountRow['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investiční účet',
  CREDIT: 'Kreditní účet',
};

function AccountListItem({
  account,
  onPress,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  reorderPending,
}: {
  account: AccountRow;
  onPress: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  reorderPending: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center border-b border-neutral-100 px-4 py-3">
      <Pressable onPress={onPress} className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-medium text-neutral-900" numberOfLines={1}>
            {account.name}
          </Text>
          <Text className="text-xs text-neutral-500">{account.currency}</Text>
        </View>
        <Text className="mt-1 text-xs text-neutral-500">{TYPE_LABELS[account.type]}</Text>
      </Pressable>
      {!account.isArchived ? (
        <View className="flex-row gap-1">
          <Pressable onPress={onMoveUp} disabled={isFirst || reorderPending} className="p-2" hitSlop={8}>
            <Text className={isFirst ? 'text-neutral-300' : 'text-neutral-700'}>↑</Text>
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={isLast || reorderPending} className="p-2" hitSlop={8}>
            <Text className={isLast ? 'text-neutral-300' : 'text-neutral-700'}>↓</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}

export default function AccountsListScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useAccountsList();
  const reorderAccount = useReorderAccount();
  const { data: repaymentCandidates } = useCreditRepaymentCandidates();

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
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Účty se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const active = data.filter((account) => !account.isArchived);
  const archived = data.filter((account) => account.isArchived);

  return (
    <ScrollView
      className="flex-1 bg-white"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      {repaymentCandidates && repaymentCandidates.length > 0 ? (
        <Link href="/(tabs)/more/accounts/credit-repayment" asChild>
          <Pressable className="mx-4 mb-2 mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3">
            <Text className="font-medium text-amber-900">
              {repaymentCandidates.length} {repaymentCandidates.length === 1 ? 'nalezené splacení' : 'nalezená splacení'} kreditky →
            </Text>
          </Pressable>
        </Link>
      ) : null}

      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Aktivní účty</Text>
      {active.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Zatím žádný aktivní účet.</Text>
      ) : (
        active.map((account, index) => (
          <AccountListItem
            key={account.id}
            account={account}
            onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)}
            isFirst={index === 0}
            isLast={index === active.length - 1}
            reorderPending={reorderAccount.isPending}
            onMoveUp={() => reorderAccount.mutate({ id: account.id, direction: -1 })}
            onMoveDown={() => reorderAccount.mutate({ id: account.id, direction: 1 })}
          />
        ))
      )}

      {archived.length > 0 ? (
        <>
          <Text className="px-4 pb-2 pt-6 text-sm font-medium text-neutral-500">Archivované</Text>
          {archived.map((account) => (
            <AccountListItem
              key={account.id}
              account={account}
              onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)}
              isFirst
              isLast
              reorderPending={false}
              onMoveUp={() => {}}
              onMoveDown={() => {}}
            />
          ))}
        </>
      ) : null}

      <Link href="/(tabs)/more/accounts/new" asChild>
        <Pressable className="m-4 items-center rounded-lg bg-neutral-900 py-3">
          <Text className="font-medium text-white">Přidat účet</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}
