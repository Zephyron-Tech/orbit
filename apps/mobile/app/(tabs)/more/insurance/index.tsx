import { Link, useRouter } from 'expo-router';
import { ArrowDownIcon, ArrowUpIcon, PlusIcon } from 'phosphor-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useInsuranceList, useReorderPolicy } from '../../../../hooks/use-insurance';
import { formatMoney } from '../../../../lib/format-money';
import type { InsurancePolicyRow } from '../../../../lib/response-types';

const STATUS_LABELS: Record<InsurancePolicyRow['status'], string> = {
  ACTIVE: 'Aktivní',
  PAID: 'Zaplaceno',
  PENDING_RENEWAL: 'Blíží se obnova',
  TERMINATED: 'Ukončeno',
};

function PolicyListItem({
  policy,
  onPress,
  isFirst,
  isLast,
  onMoveUp,
  onMoveDown,
  reorderPending,
}: {
  policy: InsurancePolicyRow;
  onPress: () => void;
  isFirst: boolean;
  isLast: boolean;
  onMoveUp: () => void;
  onMoveDown: () => void;
  reorderPending: boolean;
}): React.JSX.Element {
  return (
    <View className="flex-row items-center border-b border-line bg-surface px-4 py-3">
      <Pressable onPress={onPress} className="flex-1 active:opacity-70">
        <View className="flex-row items-center justify-between">
          <Text className="font-sans-semibold text-ink">{policy.vehicleName}</Text>
          <Text className="font-sans-medium text-ink">{formatMoney(policy.annualCost)}</Text>
        </View>
        <Text className="mt-1 text-xs text-ink-muted">
          {policy.licensePlate} · {policy.policyNumber}
        </Text>
        <Text className="mt-1 text-xs text-ink-muted">{STATUS_LABELS[policy.status]}</Text>
      </Pressable>
      <View className="flex-row gap-1">
        <Pressable onPress={onMoveUp} disabled={isFirst || reorderPending} className="rounded-lg p-2 active:bg-surface-subtle" hitSlop={8}>
          <ArrowUpIcon color={isFirst ? '#bdcac6' : '#5d6c68'} size={16} weight="regular" />
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={isLast || reorderPending} className="rounded-lg p-2 active:bg-surface-subtle" hitSlop={8}>
          <ArrowDownIcon color={isLast ? '#bdcac6' : '#5d6c68'} size={16} weight="regular" />
        </Pressable>
      </View>
    </View>
  );
}

export default function InsuranceListScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useInsuranceList();
  const reorderPolicy = useReorderPolicy();

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
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Pojistky se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      {data.policies.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-ink-muted">Zatím žádné pojistky.</Text>
        </View>
      ) : (
        data.policies.map((policy, index) => (
          <PolicyListItem
            key={policy.id}
            policy={policy}
            onPress={() => router.push(`/(tabs)/more/insurance/${policy.id}`)}
            isFirst={index === 0}
            isLast={index === data.policies.length - 1}
            reorderPending={reorderPolicy.isPending}
            onMoveUp={() => reorderPolicy.mutate({ id: policy.id, direction: -1 })}
            onMoveDown={() => reorderPolicy.mutate({ id: policy.id, direction: 1 })}
          />
        ))
      )}

      <Link href="/(tabs)/more/insurance/new" asChild>
        <Pressable className="m-4 flex-row items-center justify-center gap-2 rounded-lg bg-accent py-3 active:bg-accent-hover">
          <PlusIcon color="#f8fcfd" size={16} weight="regular" />
          <Text className="font-sans-medium text-accent-foreground">Přidat pojistku</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}
