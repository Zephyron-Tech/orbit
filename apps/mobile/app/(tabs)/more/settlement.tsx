import { ArrowCounterClockwiseIcon, CheckCircleIcon, HandshakeIcon, LockKeyIcon, ReceiptIcon } from 'phosphor-react-native';
import { useState } from 'react';
import { Alert, KeyboardAvoidingView, Modal, Platform, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native';

import { Badge } from '../../../components/badge';
import { Button } from '../../../components/button';
import { FadeInView } from '../../../components/fade-in';
import { ListSkeleton, SkeletonCard } from '../../../components/skeleton';
import { TextField } from '../../../components/text-field';
import { useCloseSettlement, useMarkSettled, useReopenSettlement, useSettlement } from '../../../hooks/use-settlement';
import { colors } from '../../../lib/colors';
import { haptics } from '../../../lib/haptics';
import { formatDate } from '../../../lib/format-date';
import { formatMoney } from '../../../lib/format-money';
import { formatPeriod } from '../../../lib/period';
import type { SettlementLine } from '../../../lib/response-types';

const MONTH_LABELS = ['leden', 'únor', 'březen', 'duben', 'květen', 'červen', 'červenec', 'srpen', 'září', 'říjen', 'listopad', 'prosinec'];

function shiftMonth(year: number, month: number, delta: number): { year: number; month: number } {
  const zeroBased = (month - 1 + delta + 12) % 12;
  const yearDelta = Math.floor((month - 1 + delta) / 12);
  return { year: year + yearDelta, month: zeroBased + 1 };
}

function periodLabel(year: number, month: number): string {
  return `${MONTH_LABELS[month - 1]} ${year}`;
}

// Matches apps/web/components/settlement/settlement-view.tsx's directionLabel/directionTone.
function directionLabel(direction: string): string {
  if (direction === 'EVEN') return 'Nikdo nic nedluží';
  if (direction === 'PARTNER_OWES_ME') return 'Partner dluží mně';
  return 'Dlužím partnerovi';
}

function directionColorClass(direction: string): string {
  if (direction === 'I_OWE_PARTNER') return 'text-critical';
  if (direction === 'PARTNER_OWES_ME') return 'text-positive';
  return 'text-ink';
}

const KIND_LABELS: Record<SettlementLine['kind'], string> = {
  EXPENSE: 'Výdaj',
  SETTLEMENT: 'Platba vyrovnání',
  UNCONVERTED: 'Nepřevedeno na CZK',
};

function Metric({ label, value }: { label: string; value: string }): React.JSX.Element {
  return (
    <View className="flex-1 rounded-lg border border-line bg-surface p-3">
      <Text className="text-xs text-ink-muted">{label}</Text>
      <Text className="font-sans-semibold mt-1 text-sm text-ink">{value}</Text>
    </View>
  );
}

function LineRow({ line }: { line: SettlementLine }): React.JSX.Element {
  return (
    <View className="rounded-lg border border-line bg-surface p-3">
      <View className="flex-row items-center justify-between">
        <Text className="flex-1 pr-3 font-sans-semibold text-ink" numberOfLines={1}>
          {line.merchant}
        </Text>
        <Text className="font-sans-medium text-ink">{formatMoney(line.total, line.currency)}</Text>
      </View>
      <View className="mt-1 flex-row items-center justify-between">
        <Text className="text-xs text-ink-muted">{formatDate(line.date)}</Text>
        {line.kind !== 'EXPENSE' ? <Badge tone={line.kind === 'UNCONVERTED' ? 'warning' : 'neutral'}>{KIND_LABELS[line.kind]}</Badge> : null}
      </View>
      {line.myShare !== null && line.partnerShare !== null ? (
        <Text className="mt-1 text-xs text-ink-muted">
          Já: {formatMoney(line.myShare)} · Partner: {formatMoney(line.partnerShare)}
        </Text>
      ) : null}
    </View>
  );
}

export default function SettlementScreen(): React.JSX.Element {
  const now = new Date();
  const [period, setPeriod] = useState({ year: now.getUTCFullYear(), month: now.getUTCMonth() + 1 });
  const [notes, setNotes] = useState('');
  const [jumpMenuOpen, setJumpMenuOpen] = useState(false);

  const { data, isPending, isError, error, refetch, isRefetching } = useSettlement(period.year, period.month);
  const closeSettlement = useCloseSettlement();
  const reopenSettlement = useReopenSettlement();
  const markSettled = useMarkSettled();

  function jumpToPeriod(monthKey: string): void {
    const [yearPart, monthPart] = monthKey.split('-').map(Number);
    if (!yearPart || !monthPart) return;
    setPeriod({ year: yearPart, month: monthPart });
    setJumpMenuOpen(false);
  }

  function handleClose(): void {
    Alert.alert('Uzavřít vyrovnání?', periodLabel(period.year, period.month), [
      { text: 'Zrušit', style: 'cancel' },
      {
        text: 'Uzavřít',
        onPress: () =>
          closeSettlement.mutate(
            { year: period.year, month: period.month, notes: notes.trim() || null },
            { onError: (mutationError) => Alert.alert('Nepodařilo se uzavřít', mutationError instanceof Error ? mutationError.message : 'Zkuste to znovu.') },
          ),
      },
    ]);
  }

  function handleReopen(id: string): void {
    Alert.alert('Znovu otevřít vyrovnání?', 'Vrátí transakce zpět do editovatelného stavu.', [
      { text: 'Zrušit', style: 'cancel' },
      { text: 'Otevřít', style: 'destructive', onPress: () => reopenSettlement.mutate({ id, year: period.year, month: period.month }) },
    ]);
  }

  return (
    <View className="flex-1 bg-canvas">
      <View className="flex-row items-center justify-between border-b border-line bg-surface px-4 py-3">
        <Pressable
          onPress={() => { haptics.tapLight(); setPeriod((current) => shiftMonth(current.year, current.month, -1)); }}
          className="rounded-lg px-3 py-1 active:bg-surface-subtle"
        >
          <Text className="text-lg text-ink">‹</Text>
        </Pressable>
        <Pressable onPress={() => { haptics.tapLight(); setJumpMenuOpen(true); }}>
          <Text className="font-sans-medium text-ink underline decoration-line-strong">{periodLabel(period.year, period.month)}</Text>
        </Pressable>
        <Pressable
          onPress={() => { haptics.tapLight(); setPeriod((current) => shiftMonth(current.year, current.month, 1)); }}
          className="rounded-lg px-3 py-1 active:bg-surface-subtle"
        >
          <Text className="text-lg text-ink">›</Text>
        </Pressable>
      </View>

      <Modal visible={jumpMenuOpen} transparent animationType="fade" onRequestClose={() => setJumpMenuOpen(false)}>
        <Pressable className="flex-1 items-center justify-center bg-ink/40" onPress={() => setJumpMenuOpen(false)}>
          <View className="max-h-[70%] w-4/5 rounded-lg bg-surface p-2">
            <ScrollView>
              {(data?.months ?? []).map((monthKey) => (
                <Pressable key={monthKey} onPress={() => jumpToPeriod(monthKey)} className="rounded-lg px-4 py-3 active:bg-surface-subtle">
                  <Text className="text-ink">{monthKey}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </Pressable>
      </Modal>

      {isPending ? (
        <View className="flex-1 gap-4 p-4">
          <SkeletonCard />
          <ListSkeleton rows={4} />
        </View>
      ) : isError ? (
        <View className="flex-1 items-center justify-center px-6">
          <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Vyrovnání se nepodařilo načíst'}</Text>
        </View>
      ) : (
        <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <ScrollView contentContainerClassName="gap-4 p-4" refreshControl={<RefreshControl refreshing={isRefetching} onRefresh={() => { haptics.tapLight(); void refetch(); }} tintColor={colors.accent} />}>
          <View className="flex-row flex-wrap gap-2">
            {data.summary.direction === 'EVEN' ? <Badge tone="success">Vyrovnáno</Badge> : null}
            {!data.isClosed ? <Badge tone="info">Otevřené</Badge> : data.settledAt ? <Badge tone="success">Uzavřené · zaplaceno</Badge> : <Badge tone="warning">Uzavřené · nezaplaceno</Badge>}
          </View>

          <FadeInView className="rounded-lg border border-line bg-surface p-5">
            <View className="flex-row items-center gap-2">
              <HandshakeIcon color="#5d6c68" size={19} weight="regular" />
              <Text className="font-sans-medium text-sm text-ink-muted">{directionLabel(data.summary.direction)}</Text>
            </View>
            <Text className={`font-sans-semibold mt-3 text-4xl ${directionColorClass(data.summary.direction)}`}>{formatMoney(data.summary.balance)}</Text>
            <Text className="mt-3 text-sm text-ink-muted">
              {data.summary.exactBalance !== null ? `Přesně ${formatMoney(data.summary.exactBalance)} před zaokrouhlením bankovního převodu.` : 'Přesná nezaokrouhlená částka se v uzavřené historii neukládá.'}
            </Text>
            <View className="mt-4 flex-row items-center gap-2 border-t border-line pt-3">
              {data.isClosed ? <LockKeyIcon color="#5d6c68" size={16} weight="regular" /> : <ReceiptIcon color="#5d6c68" size={16} weight="regular" />}
              <Text className="text-xs text-ink-muted">{data.summary.sharedCount} sdílených výdajů</Text>
            </View>
          </FadeInView>

          {data.unconvertedCount > 0 ? (
            <View className="rounded-lg border border-warning/25 bg-warning-soft p-3">
              <Text className="text-xs text-warning">{data.unconvertedCount}× nepřevedeno na CZK, chybí v součtu</Text>
            </View>
          ) : null}

          <View className="flex-row flex-wrap gap-2">
            <Metric label="Zaplaceno mnou" value={formatMoney(data.summary.paidByMe)} />
            <Metric label="Zaplaceno partnerem" value={formatMoney(data.summary.paidByPartner)} />
          </View>
          {data.summary.dueFromMe !== null || data.summary.dueFromPartner !== null ? (
            <View className="flex-row flex-wrap gap-2">
              {data.summary.dueFromMe !== null ? <Metric label="Můj podíl" value={formatMoney(data.summary.dueFromMe)} /> : null}
              {data.summary.dueFromPartner !== null ? <Metric label="Podíl partnera" value={formatMoney(data.summary.dueFromPartner)} /> : null}
            </View>
          ) : null}

          <View className="gap-2">
            <Text className="font-sans-semibold text-base text-ink">Položky ({data.lines.length})</Text>
            {data.lines.map((line) => (
              <LineRow key={line.id} line={line} />
            ))}
          </View>

          {data.isClosed ? (
            <View className="gap-2">
              {data.closedId ? (
                <Button
                  variant="secondary"
                  icon={ArrowCounterClockwiseIcon}
                  loading={reopenSettlement.isPending}
                  onPress={() => handleReopen(data.closedId as string)}
                >
                  Znovu otevřít
                </Button>
              ) : null}
              {data.closedId ? (
                <Button
                  variant="primary"
                  icon={CheckCircleIcon}
                  loading={markSettled.isPending}
                  onPress={() => markSettled.mutate({ id: data.closedId as string, settled: !data.settledAt, year: period.year, month: period.month })}
                >
                  {data.settledAt ? 'Odznačit jako zaplaceno' : 'Označit jako zaplaceno'}
                </Button>
              ) : null}
            </View>
          ) : (
            <View className="gap-2">
              <TextField placeholder="Poznámka (nepovinné)" value={notes} onChangeText={setNotes} returnKeyType="done" />
              <Button variant="primary" icon={LockKeyIcon} loading={closeSettlement.isPending} disabled={data.lines.length === 0} onPress={handleClose}>
                Uzavřít vyrovnání
              </Button>
            </View>
          )}

          {data.history.length > 0 ? (
            <View className="gap-2 border-t border-line pt-4">
              <Text className="font-sans-semibold text-base text-ink">Historie vyrovnání</Text>
              {data.history.map((entry) => (
                <Pressable
                  key={entry.id}
                  onPress={() => jumpToPeriod(entry.period)}
                  className="flex-row items-center justify-between rounded-lg border border-line bg-surface p-3 active:bg-surface-subtle"
                >
                  <Text className="text-ink capitalize">{formatPeriod(entry.period)}</Text>
                  <View className="flex-row items-center gap-2">
                    <Text className="font-sans-medium text-ink">{formatMoney(entry.balance)}</Text>
                    {entry.settledAt ? <Badge tone="success">zaplaceno</Badge> : null}
                  </View>
                </Pressable>
              ))}
            </View>
          ) : null}
        </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
