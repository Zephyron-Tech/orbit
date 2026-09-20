import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useAccountsList } from '../../../../hooks/use-accounts';
import type { AccountRow } from '../../../../lib/response-types';

const TYPE_LABELS: Record<AccountRow['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investiční účet',
  CREDIT: 'Kreditní účet',
};

function AccountListItem({ account, onPress }: { account: AccountRow; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className="border-b border-neutral-100 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <Text className="font-medium text-neutral-900" numberOfLines={1}>
          {account.name}
        </Text>
        <Text className="text-xs text-neutral-500">{account.currency}</Text>
      </View>
      <Text className="mt-1 text-xs text-neutral-500">{TYPE_LABELS[account.type]}</Text>
    </Pressable>
  );
}

export default function AccountsListScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useAccountsList();

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
      <Text className="px-4 pb-2 pt-4 text-sm font-medium text-neutral-500">Aktivní účty</Text>
      {active.length === 0 ? (
        <Text className="px-4 pb-4 text-neutral-500">Zatím žádný aktivní účet.</Text>
      ) : (
        active.map((account) => <AccountListItem key={account.id} account={account} onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)} />)
      )}

      {archived.length > 0 ? (
        <>
          <Text className="px-4 pb-2 pt-6 text-sm font-medium text-neutral-500">Archivované</Text>
          {archived.map((account) => (
            <AccountListItem key={account.id} account={account} onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)} />
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
