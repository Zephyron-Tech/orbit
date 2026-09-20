import { hc } from 'hono/client';
import type { AppType } from '@orbit/api-types';

/**
 * Hono RPC client for the `apps/api` service — every dashboard page and
 * mutation now goes through this instead of importing `prisma` directly.
 *
 * `cookieHeader` is only needed server-side (Server Components don't
 * automatically forward the incoming request's cookies to an outgoing
 * fetch); a browser-side call sends its own cookies automatically via
 * `credentials: 'include'`.
 */
/** The API's own origin — for the rare call that bypasses the typed RPC client (file uploads, a browser-navigated download link). */
export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
}

export function apiClient(cookieHeader?: string) {
  return hc<AppType>(apiBaseUrl(), {
    init: {
      credentials: 'include',
      headers: cookieHeader ? { cookie: cookieHeader } : {},
    },
  });
}

export interface ApiActionResult {
  ok: boolean;
  error?: string;
}

/**
 * Turns any Hono RPC client call into the `{ ok, error }` shape every
 * `*-manager.tsx` component's `run()` helper already expects — the same
 * contract the old server actions returned, so the client components didn't
 * need to change their own error/pending/success handling when the calls
 * underneath moved from a server action to an RPC fetch.
 */
export async function toActionResult(call: () => Promise<Response>, fallbackError: string): Promise<ApiActionResult> {
  try {
    const response = await call();
    if (!response.ok) {
      const body = (await response.json().catch(() => null)) as { error?: string } | null;
      return { ok: false, error: body?.error ?? fallbackError };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: fallbackError };
  }
}

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

export type AccountType = 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT';
export type AccountProvider = 'MONETA' | 'REVOLUT' | 'TRADING212' | 'MANUAL';

export interface AccountInput {
  name: string;
  type: AccountType;
  provider: AccountProvider;
  externalId: string | null;
  currency: string;
  includeInNetWorth: boolean;
  creditLimit: string | null;
  cardLast4: string | null;
  emergencyReserveMonths: number | null;
  annualInterestRate: string | null;
  interestTaxRate: string | null;
}

export interface CreditRepaymentCandidate {
  creditTransactionId: string | null;
  sourceTransactionId: string;
  amount: string;
  date: string;
  sourceAccountName: string;
  matchedBy: 'AMOUNT_DATE' | 'VARIABLE_SYMBOL';
  creditAccountId?: string;
  creditAccountName?: string;
}

export function createAccountViaApi(input: AccountInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().accounts.$post({ json: input }), 'Účet se nepodařilo vytvořit');
}

export function updateAccountViaApi(id: string, input: AccountInput): Promise<ApiActionResult> {
  // apps/api's routes validate the body manually (`c.req.json()`, not a
  // `zValidator` chain), so Hono's RPC client has no compile-time schema for
  // it — its inferred input type for a `:param` route is exactly `{ param }`
  // with no `json` key. Assigning through a named `const` first (rather than
  // passing a fresh object literal) sidesteps TypeScript's excess-property
  // check on the literal while staying fully type-checked otherwise; the
  // client's actual runtime implementation always forwards a `json` field
  // when present, regardless of what its type declares.
  const requestOptions = { param: { id }, json: input };
  return toActionResult(() => apiClient().accounts[':id'].$patch(requestOptions), 'Účet se nepodařilo uložit');
}

export function setAccountArchivedViaApi(id: string, isArchived: boolean): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: { isArchived } };
  return toActionResult(() => apiClient().accounts[':id'].archive.$post(requestOptions), 'Účet se nepodařilo archivovat');
}

export function deleteAccountViaApi(id: string): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().accounts[':id'].$delete({ param: { id } }), 'Účet se nepodařilo smazat');
}

export function reorderAccountViaApi(id: string, direction: -1 | 1): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().accounts.reorder.$post({ json: { id, direction } }), 'Pořadí se nepodařilo změnit');
}

export function recordCreditDebtViaApi(input: { accountId: string; debt: string; asOf: string }): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().accounts['credit-debt'].$post({ json: input }), 'Dluh se nepodařilo uložit');
}

export function confirmCreditZeroStartViaApi(accountId: string): Promise<ApiActionResult> {
  return toActionResult(
    () => apiClient().accounts[':id']['credit-zero-start'].$post({ param: { id: accountId } }),
    'Nulový počáteční stav se nepodařilo uložit',
  );
}

export function clearCreditCapacitySnapshotViaApi(accountId: string): Promise<ApiActionResult> {
  return toActionResult(
    () => apiClient().accounts[':id']['clear-credit-capacity'].$post({ param: { id: accountId } }),
    'Zůstatek se nepodařilo odstranit',
  );
}

export function confirmCreditPayoffFromCheckingViaApi(sourceTransactionId: string, creditAccountId: string): Promise<ApiActionResult> {
  return toActionResult(
    () => apiClient().accounts['credit-payoff-from-checking'].$post({ json: { sourceTransactionId, creditAccountId } }),
    'Platbu se nepodařilo spárovat',
  );
}

export function confirmCreditRepaymentViaApi(creditTransactionId: string, sourceTransactionId: string): Promise<ApiActionResult> {
  return toActionResult(
    () => apiClient().accounts['credit-repayment'].$post({ json: { creditTransactionId, sourceTransactionId } }),
    'Splacení se nepodařilo potvrdit',
  );
}

// ---------------------------------------------------------------------------
// Transactions
// ---------------------------------------------------------------------------

export interface UpdateTransactionInput {
  id: string;
  categoryId: string | null;
  bucketId: string | null;
  recurringExpenseId: string | null;
  kind: 'NORMAL' | 'INTERNAL_TRANSFER' | 'PENDING_TRANSFER' | 'SETTLEMENT';
  isShared: boolean;
  paidBy: 'ME' | 'PARTNER';
  myShareRatio: number | null;
  notes: string | null;
}

export function updateTransactionViaApi(input: UpdateTransactionInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().transactions.$patch({ json: input }), 'Neplatná data');
}

export function bulkCategorizeViaApi(ids: string[], categoryId: string | null): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().transactions['bulk-categorize'].$post({ json: { ids, categoryId } }), 'Neplatná data');
}

export function dismissUnmatchedTransferViaApi(id: string): Promise<ApiActionResult> {
  const requestOptions = { param: { id } };
  return toActionResult(
    () => apiClient().transactions[':id']['dismiss-unmatched-transfer'].$post(requestOptions),
    'Převod už není nespárovaný, nebo byl už dříve skryt.',
  );
}

export interface TransferMatchResult extends ApiActionResult {
  matched?: number;
  ambiguous?: number;
}

export async function runTransferMatchingViaApi(): Promise<TransferMatchResult> {
  try {
    const response = await apiClient().transactions['match-transfers'].$post();
    if (!response.ok) return { ok: false, error: 'Párování se nezdařilo.' };
    const body = (await response.json()) as { matched: number; ambiguous: number };
    return { ok: true, matched: body.matched, ambiguous: body.ambiguous };
  } catch {
    return { ok: false, error: 'Párování se nezdařilo.' };
  }
}

export interface CreateCategoryInput {
  name: string;
  isShared: boolean;
}

export function createCategoryViaApi(input: CreateCategoryInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().transactions.categories.$post({ json: input }), 'Kategorii se nepodařilo vytvořit.');
}

export interface UpdateCategoryInput extends CreateCategoryInput {
  id: string;
  isActive: boolean;
}

export function updateCategoryViaApi(input: UpdateCategoryInput): Promise<ApiActionResult> {
  const { id, ...json } = input;
  const requestOptions = { param: { id }, json };
  return toActionResult(() => apiClient().transactions.categories[':id'].$patch(requestOptions), 'Kategorii se nepodařilo uložit.');
}

export interface ApplyMerchantCategoryInput {
  accountId: string;
  categoryId: string;
  merchantKey: string;
  from: string;
  to: string;
}

export async function applyMerchantCategoryViaApi(input: ApplyMerchantCategoryInput): Promise<ApiActionResult & { updated?: number }> {
  try {
    const response = await apiClient().transactions['apply-merchant-category'].$post({ json: input });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; updated?: number } | null;
    if (!response.ok) return { ok: false, error: body?.error ?? 'Návrh kategorie už není platný.' };
    return { ok: true, updated: body?.updated };
  } catch {
    return { ok: false, error: 'Návrh kategorie už není platný.' };
  }
}

export async function countMerchantCategoryTargetsViaApi(input: ApplyMerchantCategoryInput): Promise<ApiActionResult & { count?: number }> {
  try {
    const response = await apiClient().transactions['count-merchant-category-targets'].$post({ json: input });
    const body = (await response.json().catch(() => null)) as { ok?: boolean; error?: string; count?: number } | null;
    if (!response.ok) return { ok: false, error: body?.error ?? 'Návrh kategorie už není platný.' };
    return { ok: true, count: body?.count };
  } catch {
    return { ok: false, error: 'Návrh kategorie už není platný.' };
  }
}

export interface SplitLineInput {
  amount: string;
  categoryId: string | null;
  isShared: boolean;
  myShareRatio: number | null;
  notes: string | null;
}

export function splitTransactionViaApi(input: { parentId: string; lines: SplitLineInput[] }): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().transactions.split.$post({ json: input }), 'Neplatná data');
}

export function mergeSplitViaApi(parentId: string): Promise<ApiActionResult> {
  const requestOptions = { param: { id: parentId } };
  return toActionResult(() => apiClient().transactions[':id']['merge-split'].$post(requestOptions), 'Neplatná transakce');
}

// ---------------------------------------------------------------------------
// Insurance
// ---------------------------------------------------------------------------

export type VehicleType = 'CAR' | 'MOTORCYCLE' | 'TRUCK_OR_TRACTOR' | 'MOPED' | 'BUS' | 'TRAILER' | 'OTHER';
export type PaymentFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'MONTHLY';
export type PolicyStatus = 'ACTIVE' | 'PAID' | 'PENDING_RENEWAL' | 'TERMINATED';

export interface InsurancePolicyInput {
  vehicleName: string;
  licensePlate: string;
  policyNumber: string;
  policyHolder: string;
  vehicleType: VehicleType;
  annualCost: string;
  paymentFrequency: PaymentFrequency;
  startDate: string;
  status: PolicyStatus;
}

export function createInsurancePolicyViaApi(input: InsurancePolicyInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().insurance.$post({ json: input }), 'Pojistku se nepodařilo vytvořit');
}

export function updateInsurancePolicyViaApi(id: string, input: InsurancePolicyInput): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: input };
  return toActionResult(() => apiClient().insurance[':id'].$patch(requestOptions), 'Pojistku se nepodařilo uložit');
}

export function deleteInsurancePolicyViaApi(id: string): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().insurance[':id'].$delete({ param: { id } }), 'Pojistku se nepodařilo smazat');
}

export function reorderInsurancePolicyViaApi(id: string, direction: -1 | 1): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().insurance.reorder.$post({ json: { id, direction } }), 'Pořadí se nepodařilo změnit');
}

// ---------------------------------------------------------------------------
// Planning (spending target, investment plans, income source rules, recurring expenses)
// ---------------------------------------------------------------------------

export interface SpendingTargetInput {
  monthlySpendingTarget: string | null;
  transferHistoryFrom: string | null;
  hideHistoricalBrokerTransfers: boolean;
}

export interface InvestmentPlanInput {
  name: string;
  sourceAccountId: string | null;
  brokerAccountId: string;
  expectedAmount: string;
  currency: string;
  dueDay: number;
  graceDays: number;
  isActive: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

export interface IncomeSourceRuleInput {
  name: string;
  merchantText: string;
  accountId: string | null;
}

export interface RecurringExpenseInput {
  name: string;
  categoryId: string | null;
  expectedAmount: string;
  currency: string;
  isShared: boolean;
  myShareRatio: number | null;
  isActive: boolean;
  dueDay: number | null;
  graceDays: number;
  startsOn: string | null;
  endsOn: string | null;
  paymentAccountId: string | null;
}

export function saveSpendingTargetViaApi(input: SpendingTargetInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['spending-target'].$post({ json: input }), 'Nastavení se nepodařilo uložit');
}

export function createInvestmentPlanViaApi(input: InvestmentPlanInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['investment-plans'].$post({ json: input }), 'Plán se nepodařilo vytvořit');
}

export function updateInvestmentPlanViaApi(id: string, input: InvestmentPlanInput): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: input };
  return toActionResult(() => apiClient().planning['investment-plans'][':id'].$patch(requestOptions), 'Plán se nepodařilo uložit');
}

export function setInvestmentPlanActiveViaApi(id: string, isActive: boolean): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: { isActive } };
  return toActionResult(() => apiClient().planning['investment-plans'][':id'].active.$post(requestOptions), 'Plán se nepodařilo změnit');
}

export function deleteInvestmentPlanViaApi(id: string): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['investment-plans'][':id'].$delete({ param: { id } }), 'Plán se nepodařilo smazat');
}

export function createIncomeSourceRuleViaApi(input: IncomeSourceRuleInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['income-source-rules'].$post({ json: input }), 'Pravidlo se nepodařilo vytvořit');
}

export function updateIncomeSourceRuleViaApi(id: string, input: IncomeSourceRuleInput): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: input };
  return toActionResult(() => apiClient().planning['income-source-rules'][':id'].$patch(requestOptions), 'Pravidlo se nepodařilo uložit');
}

export function setIncomeSourceRuleActiveViaApi(id: string, isActive: boolean): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: { isActive } };
  return toActionResult(() => apiClient().planning['income-source-rules'][':id'].active.$post(requestOptions), 'Pravidlo se nepodařilo změnit');
}

export function deleteIncomeSourceRuleViaApi(id: string): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['income-source-rules'][':id'].$delete({ param: { id } }), 'Pravidlo se nepodařilo smazat');
}

export function createRecurringExpenseViaApi(input: RecurringExpenseInput): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['recurring-expenses'].$post({ json: input }), 'Fixní výdaj se nepodařilo vytvořit');
}

export function updateRecurringExpenseViaApi(id: string, input: RecurringExpenseInput): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: input };
  return toActionResult(() => apiClient().planning['recurring-expenses'][':id'].$patch(requestOptions), 'Fixní výdaj se nepodařilo uložit');
}

export function setRecurringExpenseActiveViaApi(id: string, isActive: boolean): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: { isActive } };
  return toActionResult(() => apiClient().planning['recurring-expenses'][':id'].active.$post(requestOptions), 'Fixní výdaj se nepodařilo změnit');
}

export function deleteRecurringExpenseViaApi(id: string): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().planning['recurring-expenses'][':id'].$delete({ param: { id } }), 'Fixní výdaj se nepodařilo smazat');
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export function closeSettlementViaApi(input: { year: number; month: number; notes: string | null }): Promise<ApiActionResult> {
  return toActionResult(() => apiClient().settlement.close.$post({ json: input }), 'Vyrovnání se nepodařilo uzavřít');
}

export function reopenSettlementViaApi(id: string): Promise<ApiActionResult> {
  const requestOptions = { param: { id } };
  return toActionResult(() => apiClient().settlement[':id'].reopen.$post(requestOptions), 'Vyrovnání se nepodařilo znovu otevřít');
}

export function markSettledViaApi(id: string, settled: boolean): Promise<ApiActionResult> {
  const requestOptions = { param: { id }, json: { settled } };
  return toActionResult(() => apiClient().settlement[':id'].settled.$post(requestOptions), 'Nepodařilo se uložit');
}
