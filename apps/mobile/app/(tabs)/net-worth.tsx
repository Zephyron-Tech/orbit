import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { useDismissUnmatchedTransfer, useNetWorth } from '../../hooks/use-net-worth';
import type { NetWorthCardAccount } from '../../lib/response-types';

const CZK = new Intl.NumberFormat('cs-CZ', { maximumFractionDigits: 0 });
const TYPE_LABEL: Record<NetWorthCardAccount['type'], string> = {
  CHECKING: 'Běžný účet',
  SAVINGS: 'Spořicí účet',
  INVESTMENT: 'Investice',
  CREDIT: 'Kreditní karta',
};

function money(value: number): string {
  return `${CZK.format(value)} Kč`;
}

function formatMonth(value: string): string {
  return new Intl.DateTimeFormat('cs-CZ', { month: 'short', year: 'numeric', timeZone: 'UTC' }).format(new Date(`${value}-01T00:00:00Z`));
}

function DetailRow({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="w-1/2 py-1.5 pr-2">
      <Text className="text-xs text-neutral-500">{label}</Text>
      <Text className="mt-0.5 text-sm font-medium text-neutral-900">{value}</Text>
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
    <View className="border-t border-neutral-100 bg-neutral-50 p-3">
      <Text className="mb-2 text-xs text-neutral-500">Měsíční statistiky: {period}</Text>
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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Čisté jmění se nepodařilo načíst'}</Text>
      </View>
    );
  }

  if (data.empty) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-neutral-500">Zatím žádné aktivní účty.</Text>
      </View>
    );
  }

  return (
    <ScrollView
      className="flex-1 bg-white"
      contentContainerClassName="gap-4 p-4"
      refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => void refetch()} />}
    >
      <View className="rounded-xl border border-neutral-200 p-4">
        <Text className="text-sm text-neutral-500">Celkové čisté jmění</Text>
        <Text className="mt-1 text-2xl font-semibold text-neutral-900">{data.totalWorth.toLocaleString('cs-CZ')} Kč</Text>
        <View className="mt-3 flex-row gap-4">
          <View>
            <Text className="text-xs text-neutral-500">Hotovost</Text>
            <Text className="text-neutral-900">{data.cashValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
          <View>
            <Text className="text-xs text-neutral-500">Investice</Text>
            <Text className="text-neutral-900">{data.investmentValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
          <View>
            <Text className="text-xs text-neutral-500">Závazky</Text>
            <Text className="text-neutral-900">{data.liabilityValue.toLocaleString('cs-CZ')} Kč</Text>
          </View>
        </View>
      </View>

      <View className="gap-2">
        <Text className="text-sm font-medium text-neutral-500">Účty</Text>
        {data.cardAccounts.map((account) => {
          const balance = Number(account.balance);
          const debt = Math.max(0, -balance);
          const isOpen = expandedId === account.id;
          return (
            <View key={account.id} className="overflow-hidden rounded-lg border border-neutral-200">
              <Pressable onPress={() => setExpandedId(isOpen ? null : account.id)} className="flex-row items-center justify-between p-3">
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-neutral-900">{account.name}</Text>
                  <Text className="mt-0.5 text-xs text-neutral-500">
                    {TYPE_LABEL[account.type]}
                    {account.asOf ? ` · ${new Date(account.asOf).toLocaleDateString('cs-CZ')}` : ''}
                  </Text>
                </View>
                <Text className={`font-medium ${account.type === 'CREDIT' && debt > 0 ? 'text-red-600' : 'text-neutral-900'}`}>
                  {account.type === 'CREDIT' && debt > 0 ? '−' : ''}{money(account.type === 'CREDIT' ? debt : balance)}
                </Text>
              </Pressable>
              {account.incomplete ? <Text className="px-3 pb-2 text-xs text-amber-700">Neúplná historie — hodnota je jen spodní odhad.</Text> : null}
              {isOpen ? <AccountDetail account={account} fixedBaseline={data.fixedBaseline} /> : null}
            </View>
          );
        })}
      </View>

      {data.unmatchedTransfers.length > 0 ? (
        <View className="gap-2">
          <Text className="text-sm font-medium text-neutral-500">Nespárované převody</Text>
          {data.unmatchedTransfers.map((transfer) => (
            <View key={transfer.id} className="rounded-lg border border-neutral-200 p-3">
              <View className="flex-row items-center justify-between">
                <View className="flex-1 pr-3">
                  <Text className="font-medium text-neutral-900">{transfer.accountName}</Text>
                  <Text className="text-xs text-neutral-500">{transfer.date.slice(0, 10)} · {transfer.merchant}</Text>
                </View>
                <Text className="text-neutral-900">{transfer.amount.toLocaleString('cs-CZ')} {transfer.currency}</Text>
              </View>
              <Pressable
                onPress={() => dismissTransfer.mutate(transfer.id)}
                disabled={dismissTransfer.isPending}
                className="mt-2 self-start rounded-md bg-neutral-100 px-3 py-1.5"
              >
                <Text className="text-sm text-neutral-700">Skrýt</Text>
              </Pressable>
            </View>
          ))}
        </View>
      ) : null}
    </ScrollView>
  );
}
