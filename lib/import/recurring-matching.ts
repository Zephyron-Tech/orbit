import { normalizeMerchant } from '@/lib/finance/idempotency';

export interface RecurringMerchantEvidence {
  merchant: string | null;
  recurringExpenseId: string | null;
}

/** Builds exact merchant matches only when history maps to one expense. */
export function buildRecurringMerchantIndex(evidence: readonly RecurringMerchantEvidence[]): Map<string, string> {
  const candidates = new Map<string, Set<string>>();
  for (const row of evidence) {
    if (!row.recurringExpenseId) continue;
    const merchantKey = normalizeMerchant(row.merchant);
    if (!merchantKey) continue;
    const ids = candidates.get(merchantKey) ?? new Set<string>();
    ids.add(row.recurringExpenseId);
    candidates.set(merchantKey, ids);
  }
  const index = new Map<string, string>();
  for (const [merchantKey, ids] of candidates) {
    const [expenseId] = ids;
    if (ids.size === 1 && expenseId) index.set(merchantKey, expenseId);
  }
  return index;
}
