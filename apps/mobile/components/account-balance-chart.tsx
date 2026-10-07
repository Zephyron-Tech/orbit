import { Text, View } from 'react-native';

import type { AccountBalanceHistoryPoint } from '../lib/response-types';
import { LineChart, type LineChartPoint } from './line-chart';

const CZK = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });

function shortDate(value: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { day: 'numeric', month: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}T00:00:00Z`));
}

/**
 * Thin wrapper around the existing hand-rolled `LineChart` — balance is the
 * plotted line (so the chart itself still shows "value + delta" the same way
 * every other `LineChart` usage does), with a small stat row above it for
 * interest earned over the same period, since that's the number a flat
 * balance line can't show on its own.
 */
export function AccountBalanceChart({ history }: { history: AccountBalanceHistoryPoint[] }): React.JSX.Element {
  const points: LineChartPoint[] = history.map((point) => ({ x: 0, y: point.balance, label: shortDate(point.date) }));
  const first = history[0];
  const last = history[history.length - 1];
  const interestInPeriod = first && last ? last.cumulativeInterest - first.cumulativeInterest : 0;

  return (
    <View className="gap-2">
      {first && last ? (
        <View className="flex-row items-center justify-between rounded-lg border border-line bg-surface-subtle px-3 py-2">
          <Text className="text-xs text-ink-muted">Úrok za období</Text>
          <Text className="font-sans-semibold text-sm text-positive">+{CZK.format(interestInPeriod)} Kč</Text>
        </View>
      ) : null}
      <LineChart points={points} currency="Kč" />
    </View>
  );
}
