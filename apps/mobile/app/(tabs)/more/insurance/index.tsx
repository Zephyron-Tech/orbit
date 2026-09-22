import { Link, useRouter } from 'expo-router';
import { PlusIcon } from 'phosphor-react-native';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Button } from '../../../../components/button';
import { ReorderableList } from '../../../../components/reorderable-list';
import { useInsuranceList, useReorderPolicy } from '../../../../hooks/use-insurance';
import { formatMoney } from '../../../../lib/format-money';
import type { InsurancePolicyRow } from '../../../../lib/response-types';

const STATUS_LABELS: Record<InsurancePolicyRow['status'], string> = {
  ACTIVE: 'Aktivní',
  PAID: 'Zaplaceno',
  PENDING_RENEWAL: 'Blíží se obnova',
  TERMINATED: 'Ukončeno',
};

const ROW_HEIGHT = 84;

function PolicyListItem({ policy, onPress }: { policy: InsurancePolicyRow; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className="justify-center border-b border-line bg-surface px-2 py-3 active:opacity-70" style={{ height: ROW_HEIGHT }}>
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 font-sans-semibold text-ink" numberOfLines={1}>
          {policy.vehicleName}
        </Text>
        <Text className="font-sans-medium text-ink">{formatMoney(policy.annualCost)}</Text>
      </View>
      <Text className="mt-1 text-xs text-ink-muted" numberOfLines={1}>
        {policy.licensePlate} · {policy.policyNumber}
      </Text>
      <Text className="mt-1 text-xs text-ink-muted" numberOfLines={1}>
        {STATUS_LABELS[policy.status]}
      </Text>
    </Pressable>
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

  async function handleReorder(id: string, toIndex: number): Promise<void> {
    const fromIndex = data!.policies.findIndex((policy) => policy.id === id);
    if (fromIndex === -1) return;
    const direction: -1 | 1 = toIndex < fromIndex ? -1 : 1;
    for (let step = 0; step < Math.abs(toIndex - fromIndex); step += 1) {
      await reorderPolicy.mutateAsync({ id, direction });
    }
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
        <ReorderableList
          data={data.policies}
          keyExtractor={(policy) => policy.id}
          rowHeight={ROW_HEIGHT}
          onReorder={(id, toIndex) => void handleReorder(id, toIndex)}
          renderItem={(policy) => <PolicyListItem policy={policy} onPress={() => router.push(`/(tabs)/more/insurance/${policy.id}`)} />}
        />
      )}

      <Link href="/(tabs)/more/insurance/new" asChild>
        <Button variant="primary" icon={PlusIcon} className="m-4">
          Přidat pojistku
        </Button>
      </Link>
    </ScrollView>
  );
}
