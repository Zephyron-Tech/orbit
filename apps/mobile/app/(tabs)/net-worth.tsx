import { CaretDownIcon, ChartLineUpIcon, CreditCardIcon, PiggyBankIcon, WalletIcon, type Icon } from 'phosphor-react-native';
import { useState } from 'react';
import { Alert, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';
import Animated, { FadeIn, FadeOut, LinearTransition, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import { Badge } from '../../components/badge';
import { Button } from '../../components/button';
import { FadeInView } from '../../components/fade-in';
import { ListSkeleton, SkeletonCard } from '../../components/skeleton';
import { useDismissUnmatchedTransfer, useNetWorth } from '../../hooks/use-net-worth';
import { colors } from '../../lib/colors';
import { haptics } from '../../lib/haptics';
import { formatDate } from '../../lib/format-date';
import { formatMoney } from '../../lib/format-money';
import type { NetWorthCardAccount } from '../../lib/response-types';

const CZK = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const TYPE_LABEL: Record<NetWorthCardAccount['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investice',
  CREDIT: 'Kreditní karta',
};
// Matches apps/web/components/net-worth/account-cards.tsx's icon-per-type map.
const TYPE_ICON: Record<NetWorthCardAccount['type'], Icon> = {
  CHECKING: WalletIcon,
  SAVINGS: PiggyBankIcon,
  INVESTMENT: ChartLineUpIcon,
  CREDIT: CreditCardIcon,
};

/** Rotation lives on a plain Animated.View wrapper, not the SVG icon's own style prop — see fuel.tsx's ExpandChevronIcon for why that pattern makes the icon vanish after the first rotation. */
function ExpandChevronIcon({ open }: { open: boolean }): React.JSX.Element {
  const rotation = useSharedValue(0);
  rotation.value = withTiming(open ? 180 : 0, { duration: 200 });
  const style = useAnimatedStyle(() => ({ transform: [{ rotate: `${rotation.value}deg` }] }));

  return (
    <Animated.View style={style}>
      <CaretDownIcon color="#5d6c68" size={16} weight="regular" />
    </Animated.View>
  );
}

function money(value: number): string {
  return `${CZK.format(value)} Kč`;
}

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="w-1/2 py-1.5 pr-2">
      <Text className="text-xs text-ink-muted">{label}</Text>
      <Text className="font-sans-semibold mt-0.5 text-sm text-ink">{value}</Text>
    </View>
  );
}

function AccountDetail({ account, fixedBaseline }: { account: NetWorthCardAccount; fixedBaseline: string }): React.JSX.Element {
  const balance = Number(account.balance);
  const debt = Math.max(0, -balance);
  const limit = Number(account.creditLimit ?? 0);
  const analytics = account.analytics;
  const period = analytics.fromMonth && analytics.toMonth ? `${formatMonth(analytics.fromMonth)} až ${formatMonth(analytics.toMonth)} · ${analytics.months} měs.` : 'Zatím bez dokončené historie';

  const reserveTarget = account.emergencyReserveMonths ? Number(fixedBaseline) * account.emergencyReserveMonths : null;
  const monthlyGross = account.annualInterestRate ? (balance * Number(account.annualInterestRate)) / 12 : null;
  const monthlyNet = monthlyGross === null ? null : monthlyGross * (1 - Number(account.interestTaxRate ?? '0.15'));

  return (
    <View className="border-t border-line bg-surface-subtle p-3">
      <Text className="mb-2 text-xs text-ink-muted">Měsíční statistiky: {period}</Text>
      <View className="flex-row flex-wrap">
        {account.type === 'CHECKING' ? (
          <>
            <DetailRow label="Průměr příjmů / měsíc" value={money(Number(analytics.averageIncome))} />
            <DetailRow label="Průměr výdajů / měsíc" value={money(Number(analytics.averageExpense))} />
            <DetailRow label="Příjmy tento měsíc" value={money(Number(analytics.monthToDateIncome))} />
            <DetailRow label="Výdaje tento měsíc" value={money(Number(analytics.monthToDateExpense))} />
          </>
        ) : null}
        {account.type === 'CREDIT' ? (
          <>
            <DetailRow label="Aktuální dluh" value={money(debt)} />
            <DetailRow label="Limit" value={limit ? money(limit) : 'Nenastaven'} />
            <DetailRow label="Volná kapacita" value={limit ? money(Math.max(0, limit - debt)) : '—'} />
            <DetailRow label="Útrata tento měsíc" value={money(Number(analytics.monthToDateExpense))} />
          </>
        ) : null}
        {account.type === 'SAVINGS' ? (
          <>
            <DetailRow label="Skutečné úroky v okně" value={money(Number(analytics.interestEarned))} />
            <DetailRow
              label="Roční sazba / daň"
              value={account.annualInterestRate ? `${(Number(account.annualInterestRate) * 100).toFixed(2)} % / ${(Number(account.interestTaxRate ?? '0.15') * 100).toFixed(0)} %` : 'Nenastaveno'}
            />
            <DetailRow label="Hrubý odhad úroku / měsíc" value={monthlyGross === null ? '—' : money(monthlyGross)} />
            <DetailRow label="Čistý odhad úroku / měsíc" value={monthlyNet === null ? '—' : money(monthlyNet)} />
            <DetailRow label="Železná rezerva" value={reserveTarget === null ? 'Nenastaveno' : `${money(Math.max(0, balance))} / ${money(reserveTarget)}`} />
          </>
        ) : null}
        {account.type === 'INVESTMENT' ? (
          <>
            <DetailRow label="Hodnota pozic" value={account.portfolio?.investedValue ? money(Number(account.portfolio.investedValue)) : '—'} />
            <DetailRow label="Broker hotovost" value={account.portfolio?.cashBalance ? money(Number(account.portfolio.cashBalance)) : '—'} />
            <DetailRow label="Nerealizovaný P/L" value={account.portfolio?.unrealizedPnl ? money(Number(account.portfolio.unrealizedPnl)) : '—'} />
            <DetailRow label="Poslední snapshot" value={account.portfolio?.updatedAt ? new Date(account.portfolio.updatedAt).toLocaleString('cs-CZ') : 'Chybí'} />
            <DetailRow label="Dividendy / úrok v okně" value={money(Number(analytics.averageIncome) * analytics.months)} />
          </>
        ) : null}
      </View>
    </View>
  );
}

export default function NetWorthScreen(): React.JSX.Element {
  const { data, isPending, isError, error, refetch, isRefetching } = useNetWorth();
  const dismissTransfer = useDismissUnmatchedTransfer();
  const [expandedId, setExpandedId] = useState<string | null>(null);

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
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Čisté jmění se nepodařilo načíst'}</Text>
      </View>
    );
  }

  if (data.empty) {
    return (
      <View className="flex-1 items-center justify-center bg-canvas px-6">
        <Text className="text-center text-ink-muted">Zatím žádné aktivní účty.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-canvas"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { haptics.tapLight(); void refetch(); }} tintColor={colors.accent} />}
    >
      <FadeInView className="rounded-lg border border-line bg-surface p-5">
        <Text className="text-sm text-ink-muted">Celkové čisté jmění</Text>
        <Text className="font-sans-semibold mt-1 text-3xl text-ink">{formatMoney(String(data.totalWorth))}</Text>
        <View className="mt-4 flex-row gap-3 border-t border-line pt-3">
          <View className="flex-1">
            <Text className="text-xs text-ink-muted">Hotovost</Text>
            <Text className="font-sans-medium text-ink">{formatMoney(String(data.cashValue))}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-ink-muted">+ Investice</Text>
            <Text className="font-sans-medium text-ink">{formatMoney(String(data.investmentValue))}</Text>
          </View>
          <View className="flex-1">
            <Text className="text-xs text-ink-muted">− Závazky</Text>
            <Text className="font-sans-medium text-ink">{formatMoney(String(data.liabilityValue))}</Text>
          </View>
        </View>
      </FadeInView>

      <View className="gap-2">
        <Text className="font-sans-semibold text-base text-ink">Účty</Text>
        {data.cardAccounts.map((account) => {
          const balance = Number(account.balance);
          const debt = Math.max(0, -balance);
          const isOpen = expandedId === account.id;
          const TypeIcon = TYPE_ICON[account.type];
          return (
            <Animated.View key={account.id} layout={LinearTransition.duration(200)} className="overflow-hidden rounded-lg border border-line bg-surface">
              <Pressable
                onPress={() => { haptics.tapLight(); setExpandedId(isOpen ? null : account.id); }}
                accessibilityLabel={account.name}
                accessibilityState={{ expanded: isOpen }}
                className="flex-row items-center gap-3 p-3 active:bg-surface-subtle"
              >
                <View className="size-10 items-center justify-center rounded-xl bg-accent-soft">
                  <TypeIcon color="#17647c" size={20} weight="regular" />
                </View>
                <View className="flex-1 pr-2">
                  <View className="flex-row flex-wrap items-center gap-2">
                    <Text className="font-sans-semibold text-ink">{account.name}</Text>
                    {account.incomplete ? <Badge tone="warning">Neúplný podklad</Badge> : null}
                  </View>
                  <Text className="mt-0.5 text-xs text-ink-muted">
                    {TYPE_LABEL[account.type]}
                    {account.asOf ? ` · ${new Date(account.asOf).toLocaleDateString('cs-CZ')}` : ''}
                  </Text>
                </View>
                <Text className={`font-sans-semibold ${account.type === 'CREDIT' && debt > 0 ? 'text-critical' : 'text-ink'}`}>
                  {account.type === 'CREDIT' && debt > 0 ? '−' : ''}{money(account.type === 'CREDIT' ? debt : balance)}
                </Text>
                <ExpandChevronIcon open={isOpen} />
              </Pressable>
              {isOpen ? (
                <Animated.View entering={FadeIn.duration(150)} exiting={FadeOut.duration(150)}>
                  <AccountDetail account={account} fixedBaseline={data.fixedBaseline} />
                </Animated.View>
              ) : null}
            </Animated.View>
          );
        })}
      </View>

      {data.unmatchedTransfers.length > 0 ? (
        <View className="gap-2">
          <Text className="font-sans-semibold text-base text-ink">Nespárované převody</Text>
          {data.unmatchedTransfers.map((transfer) => (
            <View key={transfer.id} className="rounded-lg border border-line bg-surface p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="font-sans-semibold text-ink">{transfer.accountName}</Text>
                  <Text className="text-xs text-ink-muted">{formatDate(transfer.date)} · {transfer.merchant}</Text>
                </View>
                <Text className="text-ink">{transfer.amount.toLocaleString('cs-CZ')} {transfer.currency}</Text>
              </View>
              <Button
                variant="secondary"
                size="chip"
                className="mt-2 self-start"
                loading={dismissTransfer.isPending}
                onPress={() =>
                  Alert.alert('Skrýt nespárovaný převod?', `${transfer.accountName} · ${transfer.merchant}`, [
                    { text: 'Zrušit', style: 'cancel' },
                    { text: 'Skrýt', onPress: () => dismissTransfer.mutate(transfer.id) },
                  ])
                }
              >
                Skrýt
              </Button>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
