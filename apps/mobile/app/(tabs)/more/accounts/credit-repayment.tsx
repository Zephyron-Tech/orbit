import { ActivityIndicator, Pressable, ScrollView, Text, View } from 'react-native';

import { useConfirmCreditPayoffFromChecking, useConfirmCreditRepayment, useCreditRepaymentCandidates } from '../../../../hooks/use-accounts';
import type { CreditRepaymentCandidate } from '../../../../lib/response-types';

function formatMoney(value: string, currency: string): string {
  const [whole, fraction] = value.split('.');
  const grouped = (whole ?? '').replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
  const trimmedFraction = fraction?.replace(/0+$/, '');
  return `${grouped}${trimmedFraction ? `,${trimmedFraction}` : ''} ${currency}`;
}

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
      <View className="flex-1 items-center justify-center bg-white">
        <ActivityIndicator />
      </View>
    );
  }

  if (isError) {
    return (
      <View className="flex-1 items-center justify-center bg-white px-6">
        <Text className="text-center text-red-600">{error instanceof Error ? error.message : 'Nepodařilo se načíst'}</Text>
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
    <ScrollView className="flex-1 bg-white" contentContainerClassName="gap-3 p-4">
      <Text className="text-sm text-neutral-500">Po ruční platbě v bance potvrďte odpovídající dvojici importovaných pohybů.</Text>

      {data.length === 0 ? (
        <Text className="py-6 text-center text-neutral-500">Žádná nalezená splacení.</Text>
      ) : (
        data.map((candidate) => (
          <View key={candidate.sourceTransactionId} className="gap-2 rounded-lg border border-neutral-200 p-4">
            <Text className="text-sm text-neutral-700">
              {candidate.date} · {candidate.sourceAccountName} →{' '}
              {candidate.matchedBy === 'VARIABLE_SYMBOL' ? candidate.creditAccountName : 'kreditní karta'}
            </Text>
            <Text className="text-base font-semibold text-neutral-900">{formatMoney(candidate.amount, 'CZK')}</Text>
            {candidate.matchedBy === 'VARIABLE_SYMBOL' ? (
              <Text className="text-xs text-neutral-500">Podle variabilního symbolu kreditky — výpis karty zatím není nahraný.</Text>
            ) : null}
            <Pressable onPress={() => handleConfirm(candidate)} disabled={pending} className="mt-1 items-center rounded-lg bg-neutral-900 py-2.5">
              <Text className="font-medium text-white">{pending ? 'Potvrzuji…' : 'Potvrdit splacení'}</Text>
            </Pressable>
          </View>
        ))
      )}
    </ScrollView>
  );
}
