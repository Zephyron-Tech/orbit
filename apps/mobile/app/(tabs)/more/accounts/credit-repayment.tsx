import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useConfirmCreditPayoffFromChecking, useConfirmCreditRepayment, useCreditRepaymentCandidates } from '../../../../hooks/use-accounts';
import { formatMoney } from '../../../../lib/format-money';
import type { CreditRepaymentCandidate } from '../../../../lib/response-types';

/**
 * Two independent detection strategies, mirroring apps/web's account-manager.tsx:
 * AMOUNT_DATE (both legs already imported) confirms via /credit-repayment;
 * VARIABLE_SYMBOL (checking-side payment with no card statement imported yet)
 * confirms via /credit-payoff-from-checking.
 */
export default function CreditRepaymentScreen(): React.JSX.Element {
  const { data, isPending, isError, error } = useCreditRepaymentCandidates();
  const confirmPayoffFromChecking = useConfirmCreditPayoffFromChecking();
  const confirmRepayment = useConfirmCreditRepayment();

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
        <Text className="text-center text-critical">{error instanceof Error ? error.message : 'Nepodařilo se načíst'}</Text>
      </View>
    );
  }

  const pending = confirmPayoffFromChecking.isPending || confirmRepayment.isPending;

  function handleConfirm(candidate: CreditRepaymentCandidate): void {
    if (candidate.matchedBy === 'VARIABLE_SYMBOL' && candidate.creditAccountId) {
      confirmPayoffFromChecking.mutate({ sourceTransactionId: candidate.sourceTransactionId, creditAccountId: candidate.creditAccountId });
    } else if (candidate.creditTransactionId) {
      confirmRepayment.mutate({ creditTransactionId: candidate.creditTransactionId, sourceTransactionId: candidate.sourceTransactionId });
    }
  }

  return (
    <ScrollView className="flex-1 bg-canvas" contentContainerClassName="gap-3 p-4">
      <Text className="text-sm text-ink-muted">Po ruční platbě v bance potvrďte odpovídající dvojici importovaných pohybů.</Text>

      {data.length === 0 ? (
        <Text className="py-6 text-center text-ink-muted">Žádná nalezená splacení.</Text>
      ) : (
        data.map((candidate) => (
          <View key={candidate.sourceTransactionId} className="gap-2 rounded-xl border border-line bg-surface p-4">
            <Text className="text-sm text-ink-muted">
              {candidate.date} · {candidate.sourceAccountName} →{' '}
              {candidate.matchedBy === 'VARIABLE_SYMBOL' ? candidate.creditAccountName : 'kreditní karta'}
            </Text>
            <Text className="text-base font-sans-semibold text-ink">{formatMoney(candidate.amount, 'CZK')}</Text>
            {candidate.matchedBy === 'VARIABLE_SYMBOL' ? (
              <Text className="text-xs text-ink-muted">Podle variabilního symbolu kreditky — výpis karty zatím není nahraný.</Text>
            ) : null}
            <Pressable onPress={() => handleConfirm(candidate)} disabled={pending} className="mt-1 items-center rounded-lg bg-accent py-2.5 active:bg-accent-hover">
              <Text className="font-sans-medium text-accent-foreground">{pending ? 'Potvrzuji…' : 'Potvrdit splacení'}</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
