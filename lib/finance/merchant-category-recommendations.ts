import { normalizeMerchant } from './idempotency';

export interface MerchantCategoryEvidence {
  id: string;
  accountId: string;
  provider: string;
  merchant: string | null;
  date: Date;
  amount: string;
  categoryId: string | null;
  settlementId: string | null;
  parentId: string | null;
  kind: string;
}

export interface MerchantCategoryRecommendation {
  accountId: string;
  provider: string;
  merchantKey: string;
  merchantLabel: string;
  categoryId: string;
  supportingMonths: number;
  evidenceMonths: number;
  confidence: number;
  targetIds: string[];
}

function monthKey(date: Date): string {
  return date.toISOString().slice(0, 7);
}

function isEligible(transaction: MerchantCategoryEvidence): boolean {
  return transaction.kind === 'NORMAL' && transaction.amount.startsWith('-') && transaction.parentId === null;
}

/** Pure, conservative category evidence. Never writes or infers fuzzy merchants. */
export function recommendMerchantCategories(
  history: readonly MerchantCategoryEvidence[],
  target: readonly MerchantCategoryEvidence[],
  activeCategoryIds: ReadonlySet<string>,
): MerchantCategoryRecommendation[] {
  const votes = new Map<string, Map<string, Set<string>>>();
  const labels = new Map<string, string>();

  for (const transaction of history) {
    if (!isEligible(transaction) || !transaction.categoryId) continue;
    const merchantKey = normalizeMerchant(transaction.merchant);
    if (!merchantKey) continue;
    const groupKey = `${transaction.provider}|${transaction.accountId}|${merchantKey}`;
    labels.set(groupKey, transaction.merchant ?? merchantKey);
    const byMonth = votes.get(groupKey) ?? new Map<string, Set<string>>();
    const categories = byMonth.get(monthKey(transaction.date)) ?? new Set<string>();
    categories.add(transaction.categoryId);
    byMonth.set(monthKey(transaction.date), categories);
    votes.set(groupKey, byMonth);
  }

  const targets = new Map<string, MerchantCategoryEvidence[]>();
  for (const transaction of target) {
    if (!isEligible(transaction) || transaction.categoryId !== null || transaction.settlementId !== null) continue;
    const merchantKey = normalizeMerchant(transaction.merchant);
    if (!merchantKey) continue;
    const groupKey = `${transaction.provider}|${transaction.accountId}|${merchantKey}`;
    labels.set(groupKey, transaction.merchant ?? merchantKey);
    const rows = targets.get(groupKey) ?? [];
    rows.push(transaction);
    targets.set(groupKey, rows);
  }

  const output: MerchantCategoryRecommendation[] = [];
  for (const [groupKey, targetRows] of targets) {
    const byMonth = votes.get(groupKey);
    if (!byMonth) continue;
    const counts = new Map<string, number>();
    let evidenceMonths = 0;
    for (const categories of byMonth.values()) {
      evidenceMonths += 1;
      if (categories.size === 1) {
        const categoryId = [...categories][0];
        if (categoryId) counts.set(categoryId, (counts.get(categoryId) ?? 0) + 1);
      }
    }
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    const [winner] = ranked;
    if (!winner) continue;
    const [categoryId, supportingMonths] = winner;
    const runnerUp = ranked[1]?.[1] ?? 0;
    const confidence = evidenceMonths === 0 ? 0 : supportingMonths / evidenceMonths;
    if (!activeCategoryIds.has(categoryId) || supportingMonths < 3 || confidence < 0.8 || supportingMonths - runnerUp < 2) continue;
    const [provider, accountId, merchantKey] = groupKey.split('|');
    if (!provider || !accountId || !merchantKey) continue;
    output.push({
      accountId,
      provider,
      merchantKey,
      merchantLabel: labels.get(groupKey) ?? merchantKey,
      categoryId,
      supportingMonths,
      evidenceMonths,
      confidence,
      targetIds: targetRows.map((row) => row.id),
    });
  }

  return output.sort((a, b) => b.targetIds.length - a.targetIds.length || a.merchantLabel.localeCompare(b.merchantLabel));
}
