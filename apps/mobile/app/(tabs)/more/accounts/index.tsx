import { Link, useRouter } from 'expo-router';
import { ArchiveIcon, BankIcon, PlusIcon } from 'phosphor-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../../components/badge';
import { Button } from '../../../../components/button';
import { ReorderableList } from '../../../../components/reorderable-list';
import { useAccountsList, useCreditRepaymentCandidates, useReorderAccount } from '../../../../hooks/use-accounts';
import type { AccountRow } from '../../../../lib/response-types';

const TYPE_LABELS: Record<AccountRow['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investiční účet',
  CREDIT: 'Kreditní účet',
};

const ROW_HEIGHT = 66;

function AccountListItem({ account, onPress }: { account: AccountRow; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 border-b border-line bg-surface px-2 py-3 active:opacity-70" style={{ height: ROW_HEIGHT }}>
      <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
        <BankIcon color="#17647c" size={18} weight="regular" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-sans-semibold text-ink" numberOfLines={1}>
            {account.name}
          </Text>
          {account.isArchived ? <Badge tone="neutral">Archivováno</Badge> : null}
        </View>
        <Text className="mt-1 text-xs text-ink-muted" numberOfLines={1}>
          {TYPE_LABELS[account.type]} · {account.currency}
        </Text>
      </View>
    </Pressable>
  );
}

export default function AccountsListScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useAccountsList();
  const reorderAccount = useReorderAccount();
  const { data: repaymentCandidates } = useCreditRepaymentCandidates();

  if (isPending) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas">
        <ActivityIndicator color="#17647c" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Účty se nepodařilo načíst'}</Text>
      </View>
    );
  }

  const active = data.filter((account) => !account.isArchived);
  const archived = data.filter((account) => account.isArchived);

  async function handleReorder(id: string, toIndex: number): Promise<void> {
    const fromIndex = active.findIndex((account) => account.id === id);
    if (fromIndex === -1) return;
    const direction: -1 | 1 = toIndex < fromIndex ? -1 : 1;
    for (let step = 0; step < Math.abs(toIndex - fromIndex); step += 1) {
      await reorderAccount.mutateAsync({ id, direction });
    }
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      {repaymentCandidates && repaymentCandidates.length > 0 ? (
        <Link href="/(tabs)/more/accounts/credit-repayment" asChild>
          <Pressable className="mx-4 mb-2 mt-4 rounded-xl border border-accent/25 bg-accent-soft px-4 py-3 active:opacity-80">
            <Text className="font-sans-medium text-accent">
              {repaymentCandidates.length} {repaymentCandidates.length === 1 ? 'nalezené splacení' : 'nalezená splacení'} kreditky →
            </Text>
          </Pressable>
        </Link>
      ) : null}

      <View className="flex-row items-center justify-between px-4 pb-2 pt-4">
        <Text className="font-sans-semibold text-base text-ink">Aktivní účty</Text>
        <Link href="/(tabs)/more/accounts/new" asChild>
          <Pressable className="flex-row items-center gap-1 rounded-md bg-accent-soft px-2 py-1 active:bg-line">
            <PlusIcon color="#17647c" size={13} weight="bold" />
            <Text className="text-xs text-accent">Přidat</Text>
          </Pressable>
        </Link>
      </View>
      {active.length === 0 ? (
        <Text className="px-4 pb-4 text-ink-muted">Zatím žádný aktivní účet.</Text>
      ) : (
        <ReorderableList
          data={active}
          keyExtractor={(account) => account.id}
          rowHeight={ROW_HEIGHT}
          onReorder={(id, toIndex) => void handleReorder(id, toIndex)}
          renderItem={(account) => <AccountListItem account={account} onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)} />}
        />
      )}

      {archived.length > 0 ? (
        <>
          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Archivované</Text>
          {archived.map((account) => (
            <AccountListItem key={account.id} account={account} onPress={() => router.push(`/(tabs)/more/accounts/${account.id}`)} />
          ))}
        </>
      ) : (
        <View className="flex-row items-center gap-2 border-t border-line px-4 py-5">
          <ArchiveIcon color="#5d6c68" size={16} weight="regular" />
          <Text className="text-sm text-ink-muted">Žádné archivované účty</Text>
        </View>
      )}

      <Link href="/(tabs)/more/accounts/new" asChild>
        <Button variant="primary" icon={PlusIcon} className="m-4">
          Přidat účet
        </Button>
      </Link>
    </ScrollView>
  );
}
