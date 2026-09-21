import { Link, useRouter } from 'expo-router';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useInsuranceList, useReorderPolicy } from '../../../../hooks/use-insurance';
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
    <View className="flex-row items-center border-b border-neutral-100 px-4 py-3">
      <Pressable onPress={onPress} className="flex-1">
        <View className="flex-row items-center justify-between">
          <Text className="font-medium text-neutral-900">{policy.vehicleName}</Text>
          <Text className="text-neutral-900">{policy.annualCost} Kč</Text>
        </View>
        <Text className="mt-1 text-xs text-neutral-500">
          {policy.licensePlate} · {policy.policyNumber}
        </Text>
        <Text className="mt-1 text-xs text-neutral-500">{STATUS_LABELS[policy.status]}</Text>
      </Pressable>
      <View className="flex-row gap-1">
        <Pressable onPress={onMoveUp} disabled={isFirst || reorderPending} className="p-2" hitSlop={8}>
          <Text className={isFirst ? 'text-neutral-300' : 'text-neutral-700'}>↑</Text>
        </Pressable>
        <Pressable onPress={onMoveDown} disabled={isLast || reorderPending} className="p-2" hitSlop={8}>
          <Text className={isLast ? 'text-neutral-300' : 'text-neutral-700'}>↓</Text>
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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Pojistky se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      {data.policies.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-neutral-500">Zatím žádné pojistky.</Text>
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
        <Pressable className="m-4 items-center rounded-lg bg-neutral-900 py-3">
          <Text className="font-medium text-white">Přidat pojistku</Text>
        </Pressable>
      </Link>
    </ScrollView>
  );
}
