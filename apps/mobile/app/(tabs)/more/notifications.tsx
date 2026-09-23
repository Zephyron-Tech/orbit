import { BankIcon, ChartLineUpIcon, DatabaseIcon, DotsThreeCircleIcon } from 'phosphor-react-native';
import { ScrollView, Text, View } from 'react-native';

import { Skeleton } from '../../../components/skeleton';
import { Switch } from '../../../components/switch';
import { useNotificationPreferences, useUpdateNotificationPreferences } from '../../../hooks/use-notification-preferences';
import type { NotificationPreferences } from '../../../lib/response-types';

interface ToggleRow {
  key: keyof NotificationPreferences;
  label: string;
}

interface ToggleGroup {
  icon: React.ReactNode;
  title: string;
  rows: ToggleRow[];
}

const GROUPS: ToggleGroup[] = [
  {
    icon: <BankIcon color="#5d6c68" size={16} weight="regular" />,
    title: 'Pojištění a finance',
    rows: [
      { key: 'insuranceRenewal', label: 'Blížící se obnova pojistky' },
      { key: 'dcaOverdue', label: 'DCA plán po termínu' },
      { key: 'recurringExpenseOverdue', label: 'Fixní výdaj po termínu' },
      { key: 'cashBufferLow', label: 'Nízká rezerva na spořáku' },
      { key: 'creditUtilizationHigh', label: 'Vysoké čerpání kreditky' },
    ],
  },
  {
    icon: <ChartLineUpIcon color="#5d6c68" size={16} weight="regular" />,
    title: 'Portfolio',
    rows: [
      { key: 'portfolioDigest', label: 'Večerní přehled portfolia' },
      { key: 'bigPortfolioMove', label: 'Velký pohyb portfolia' },
      { key: 'dividendReceived', label: 'Připsaná dividenda/úrok' },
    ],
  },
  {
    icon: <DatabaseIcon color="#5d6c68" size={16} weight="regular" />,
    title: 'Data a import',
    rows: [
      { key: 'statementCoverageGap', label: 'Mezera ve výpisech' },
      { key: 'failedImportRow', label: 'Chyba importu' },
      { key: 'unmatchedTransferStuck', label: 'Nespárovaný převod' },
      { key: 'uncategorizedPileup', label: 'Hromadící se nezařazené výdaje' },
    ],
  },
  {
    icon: <DotsThreeCircleIcon color="#5d6c68" size={16} weight="regular" />,
    title: 'Ostatní',
    rows: [
      { key: 'settlementNotClosed', label: 'Neuzavřené vyrovnání' },
      { key: 'fuelReceiptMissing', label: 'Chybějící účtenka za palivo' },
    ],
  },
];

export default function NotificationPreferencesScreen(): React.JSX.Element {
  const { data, isPending, isError, error } = useNotificationPreferences();
  const update = useUpdateNotificationPreferences();

  if (isPending) {
    return (
      <View className="flex-1 gap-4 bg-canvas p-4">
        <Skeleton className="h-32 rounded-xl" />
        <Skeleton className="h-32 rounded-xl" />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Nastavení notifikací se nepodařilo načíst'}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-4 p-4">
      {GROUPS.map((group) => (
        <View key={group.title} className="gap-3 rounded-xl border border-line bg-surface p-4">
          <View className="flex-row items-center gap-2">
            {group.icon}
            <Text className="font-sans-semibold text-base text-ink">{group.title}</Text>
          </View>
          {group.rows.map((row) => (
            <View key={row.key} className="flex-row items-center justify-between gap-3">
              <Text className="flex-1 text-sm text-ink">{row.label}</Text>
              <Switch value={data[row.key]} onValueChange={(next) => update.mutate({ [row.key]: next })} />
            </View>
          ))}
        </View>
      ))}
    </ScrollView>
  );
}
