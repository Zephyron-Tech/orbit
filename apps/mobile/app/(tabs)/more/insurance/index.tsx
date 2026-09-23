import { Link, useRouter } from 'expo-router';
import { CarIcon, PlusIcon } from 'phosphor-react-native';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge, type BadgeTone } from '../../../../components/badge';
import { Button } from '../../../../components/button';
import { ReorderableList } from '../../../../components/reorderable-list';
import { ListSkeleton } from '../../../../components/skeleton';
import { useInsuranceList, useReorderPolicy } from '../../../../hooks/use-insurance';
import { colors } from '../../../../lib/colors';
import { formatMoney } from '../../../../lib/format-money';
import { haptics } from '../../../../lib/haptics';
import type { InsurancePolicyRow } from '../../../../lib/response-types';

const STATUS_LABELS: Record<InsurancePolicyRow['status'], string> = {
  ACTIVE: 'Aktivní',
  PAID: 'Zaplaceno',
  PENDING_RENEWAL: 'Blíží se obnova',
  TERMINATED: 'Ukončeno',
};

const STATUS_TONE: Record<InsurancePolicyRow['status'], BadgeTone> = {
  ACTIVE: 'success',
  PAID: 'neutral',
  PENDING_RENEWAL: 'warning',
  TERMINATED: 'danger',
};

const ROW_HEIGHT = 70;

function PolicyListItem({ policy, onPress }: { policy: InsurancePolicyRow; onPress: () => void }): React.JSX.Element {
  return (
    <Pressable onPress={onPress} className="flex-row items-center gap-3 border-b border-line bg-surface px-4 py-3 active:opacity-70" style={{ height: ROW_HEIGHT }}>
      <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
        <CarIcon color={colors.accent} size={18} weight="regular" />
      </View>
      <View className="flex-1">
        <View className="flex-row items-center justify-between gap-2">
          <Text className="flex-1 font-sans-semibold text-ink" numberOfLines={1}>
            {policy.vehicleName}
          </Text>
          <Text className="font-sans-medium text-ink">{formatMoney(policy.annualCost)}</Text>
        </View>
        <View className="mt-1 flex-row items-center justify-between gap-2">
          <Text className="flex-1 text-xs text-ink-muted" numberOfLines={1}>
            {policy.licensePlate} · {policy.policyNumber}
          </Text>
          <Badge tone={STATUS_TONE[policy.status]}>{STATUS_LABELS[policy.status]}</Badge>
        </View>
      </View>
    </Pressable>
  );
}

export default function InsuranceListScreen(): React.JSX.Element {
  const router = useRouter();
  const { data, isPending, isError, error, refetch, isRefetching } = useInsuranceList();
  const reorderPolicy = useReorderPolicy();

  if (isPending) {
    return (
      <View className="flex-1 bg-canvas">
        <ListSkeleton rows={4} />
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

  const handleReorder = async (id: string, toIndex: number): Promise<void> => {
    const fromIndex = data.policies.findIndex((policy) => policy.id === id);
    if (fromIndex === -1) return;
    const direction: -1 | 1 = toIndex < fromIndex ? -1 : 1;
    for (let step = 0; step < Math.abs(toIndex - fromIndex); step += 1) {
      await reorderPolicy.mutateAsync({ id, direction });
    }
  };

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      refreshControl={
        <RefreshControl refreshing={isRefetching} onRefresh={() => { haptics.tapLight(); void refetch(); }} tintColor={colors.accent} />
      }
    >
      {data.policies.length > 0 ? (
        <View className="m-4 rounded-lg border border-line bg-surface p-4">
          <Text className="text-sm text-ink-muted">Celková cena pojistek ročně</Text>
          <Text className="font-sans-semibold mt-1 text-2xl text-ink">{formatMoney(data.overview.annualCostTotal)}</Text>
        </View>
      ) : null}

      {data.policies.length === 0 ? (
        <View className="items-center py-10">
          <Text className="text-ink-muted">Zatím žádné pojistky.</Text>
        </View>
      ) : (
        <View className="mx-4">
          <ReorderableList
            data={data.policies}
            keyExtractor={(policy) => policy.id}
            rowHeight={ROW_HEIGHT}
            onReorder={(id, toIndex) => void handleReorder(id, toIndex)}
            renderItem={(policy) => <PolicyListItem policy={policy} onPress={() => router.push(`/(tabs)/more/insurance/${policy.id}`)} />}
          />
        </View>
      )}

      <Link href="/(tabs)/more/insurance/new" asChild>
        <Button variant="primary" icon={PlusIcon} className="m-4">
          Přidat pojistku
        </Button>
      </Link>
    </ScrollView>
  );
}
