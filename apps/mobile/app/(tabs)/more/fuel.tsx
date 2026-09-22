import { CaretDownIcon, WarningCircleIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { ListSkeleton, SkeletonCard } from '../../../components/skeleton';
import { useFuel } from '../../../hooks/use-fuel';
import { formatDate } from '../../../lib/format-date';
import { formatMoney } from '../../../lib/format-money';
import { formatPeriod } from '../../../lib/period';
import type { FuelMonthlyRow } from '../../../lib/response-types';

export default function FuelScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = useFuel();
  const [expandedMonth, setExpandedMonth] = useState<string | null>(null);

  if (isPending) {
    return (
      <View className="flex-1 gap-4 bg-canvas p-4">
        <SkeletonCard />
        <ListSkeleton rows={4} />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Přehled paliva se nepodařilo načíst'}</Text>
      </View>
    );
  }

  // API returns oldest-first (apps/web's FuelManager relies on that order) —
  // newest-first is what makes sense to read on mobile, so reverse here.
  const monthsNewestFirst: FuelMonthlyRow[] = [...data.overview.monthly].reverse();

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} tintColor="#17647c" />}
    >
      <View className="gap-2">
        <Text className="font-sans-semibold text-base text-ink">Přehled podle měsíce</Text>
        {monthsNewestFirst.length === 0 ? (
          <Text className="text-ink-muted">Zatím žádná data.</Text>
        ) : (
          monthsNewestFirst.map((row) => {
            const isOpen = expandedMonth === row.month;
            const missingCount = row.purchases.filter((p) => p.missingReceipt).length;
            return (
              <View key={row.month} className="overflow-hidden rounded-lg border border-line bg-surface">
                <Pressable
                  onPress={() => setExpandedMonth(isOpen ? null : row.month)}
                  className="flex-row items-center justify-between p-3 active:bg-surface-subtle"
                >
                  <View className="flex-1 pr-2">
                    <Text className="font-sans-medium capitalize text-ink">{formatPeriod(row.month)}</Text>
                    {missingCount > 0 ? (
                      <View className="mt-1 flex-row items-center gap-1 self-start">
                        <Badge tone="warning">{`${missingCount}× chybí účtenka`}</Badge>
                      </View>
                    ) : null}
                  </View>
                  <Text className="font-sans-medium text-ink">
                    {formatMoney(row.totalCzk)} · {row.liters} l
                  </Text>
                  <CaretDownIcon
                    color="#5d6c68"
                    size={16}
                    weight="regular"
                    style={[{ marginLeft: 8 }, isOpen ? { transform: [{ rotate: '180deg' }] } : undefined]}
                  />
                </Pressable>
                {isOpen ? (
                  <View className="border-t border-line bg-surface-subtle">
                    {row.purchases.length === 0 ? (
                      <Text className="p-3 text-sm text-ink-muted">Žádné nákupy.</Text>
                    ) : (
                      row.purchases.map((purchase, index) => (
                        <View
                          key={purchase.id}
                          className={`flex-row items-center justify-between p-3 ${index < row.purchases.length - 1 ? 'border-b border-line' : ''}`}
                        >
                          <View className="flex-1 pr-3">
                            <View className="flex-row items-center gap-1.5">
                              <Text className="text-sm text-ink" numberOfLines={1}>
                                {purchase.stationName}
                              </Text>
                              {purchase.missingReceipt ? <WarningCircleIcon color="#8a5a13" size={14} weight="fill" /> : null}
                            </View>
                            <Text className="text-xs text-ink-muted">
                              {formatDate(purchase.purchasedAt)} · {purchase.quantityLiters} l
                            </Text>
                          </View>
                          <Text className="text-sm font-sans-medium text-ink">{formatMoney(purchase.amountCzk)}</Text>
                        </View>
                      ))
                    )}
                  </View>
                ) : null}
              </View>
            );
          })
        )}
      </View>

      <Text className="text-xs text-ink-faint">Nahrávání účtenek a exportů se dělá na obrazovce Import.</Text>
    </ScrollView>
  );
}
