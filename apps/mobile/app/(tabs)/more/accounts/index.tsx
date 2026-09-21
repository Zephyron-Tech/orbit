import { Link, useRouter } from 'expo-router';
import { ArchiveIcon, ArrowDownIcon, ArrowUpIcon, BankIcon, PlusIcon } from 'phosphor-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../../components/badge';
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
    <View className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3">
      <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
        <BankIcon color="#17647c" size={18} weight="regular" />
      </View>
      <Pressable onPress={onPress} className="flex-1 active:opacity-70">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-sans-semibold text-ink" numberOfLines={1}>
            {account.name}
          </Text>
          {account.isArchived ? <Badge tone="neutral">Archivováno</Badge> : null}
        </View>
        <Text className="mt-1 text-xs text-ink-muted">
          {TYPE_LABELS[account.type]} · {account.currency}
        </Text>
      </Pressable>
      {!account.isArchived ? (
        <View className="flex-row gap-1">
          <Pressable onPress={onMoveUp} disabled={isFirst || reorderPending} className="rounded-lg p-2 active:bg-surface-subtle" hitSlop={8}>
            <ArrowUpIcon color={isFirst ? '#bdcac6' : '#5d6c68'} size={16} weight="regular" />
          </Pressable>
          <Pressable onPress={onMoveDown} disabled={isLast || reorderPending} className="rounded-lg p-2 active:bg-surface-subtle" hitSlop={8}>
            <ArrowDownIcon color={isLast ? '#bdcac6' : '#5d6c68'} size={16} weight="regular" />
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
          <Text className="px-4 pb-2 pt-6 font-sans-semibold text-base text-ink">Archivované</Text>
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
      ) : (
        <View className="flex-row items-center gap-2 border-t border-line px-4 py-5">
          <ArchiveIcon color="#5d6c68" size={16} weight="regular" />
          <Text className="text-sm text-ink-muted">Žádné archivované účty</Text>
        </View>
      )}

      <Link href="/(tabs)/more/accounts/new" asChild>
        <Pressable className="m-4 flex-row items-center justify-center gap-2 rounded-lg bg-accent py-3 active:bg-accent-hover">
          <PlusIcon color="#f8fcfd" size={16} weight="regular" />
          <Text className="font-sans-medium text-accent-foreground">Přidat účet</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}
