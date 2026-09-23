// Hand-written response shapes mirroring apps/api's `c.json(...)` calls.
// The routes below don't use `zValidator` for their query/body parsing, so
// Hono's RPC client can't statically infer a precise response type for
// them — these interfaces restore real typed access in the mobile screens
// instead of leaving every `useQuery`/`useMutation` typed as `unknown`.

interface SignedMoney {
  formatted: string;
  isNegative: boolean;
  isPositive: boolean;
  isZero: boolean;
}

export interface DashboardAction {
  key: string;
  title: string;
  count: number;
  detail: string;
  href: string;
}

export interface DashboardRecurringExpense {
  id: string;
  name: string;
  expectedAmount: string;
  currency: string;
  isMissing: boolean;
  stateLabel: string;
  stateTone: 'info' | 'warning' | 'success';
  actualAmount: string | null;
  difference: SignedMoney | null;
}

export interface DashboardResponse {
  period: { year: number; month: number; key: string; transactionPeriod: string };
  asOf: string;
  previousAsOf: string;
  visibleMonths: string[];
  netWorth: { totalWorth: string; cashValue: string; investmentValue: string; liabilityValue: string; incompleteAccountsCount: number };
  worthDelta: SignedMoney;
  worthDeltaPercent: { formatted: string; isPositive: boolean } | null;
  cashInvestmentRatio: string | null;
  composition: { cashShare: number; investmentShare: number; liabilityShare: number };
  zeroCashAndInvestment: boolean;
  fixedIncome: string;
  credit: { utilization: string | null; used: string; limit: string; accountsCount: number };
  dca: { plansCount: number; unmatchedCount: number; overdueCount: number; pendingCount: number };
  insurance: {
    monthlyAccrualCost: string;
    annualCostTotal: string;
    upcomingRenewals: { policyId: string; vehicleName: string; licensePlate: string; nextDueDate: string }[];
    sinkingFundCovered: boolean;
    sinkingFundShortfall: string;
  };
  actions: DashboardAction[];
  burnRate: { total: string; target: string | null; targetDifference: SignedMoney | null; spendingTargetProgress: number | null };
  recurringExpenses: DashboardRecurringExpense[];
}

export interface AccountAnalytics {
  averageIncome: string;
  medianIncome: string;
  averageExpense: string;
  medianExpense: string;
  monthToDateIncome: string;
  monthToDateExpense: string;
  refunds: string;
  interestEarned: string;
  months: number;
  fromMonth: string | null;
  toMonth: string | null;
}

export interface NetWorthCardAccount {
  id: string;
  name: string;
  type: 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT';
  provider: string;
  balance: string;
  source: string;
  asOf: string | null;
  incomplete: boolean;
  creditLimit: string | null;
  annualInterestRate: string | null;
  interestTaxRate: string | null;
  emergencyReserveMonths: number | null;
  portfolio: { cashBalance: string | null; investedValue: string | null; unrealizedPnl: string | null; updatedAt: string; currency: string } | null;
  analytics: AccountAnalytics;
}

export interface NetWorthUnmatchedTransfer {
  id: string;
  date: string;
  amount: number;
  amountCzk: number | null;
  currency: string;
  merchant: string;
  accountName: string;
}

export type NetWorthResponse =
  | { empty: true }
  | {
      empty: false;
      totalWorth: number;
      cashValue: number;
      investmentValue: number;
      liabilityValue: number;
      cardAccounts: NetWorthCardAccount[];
      fixedBaseline: string;
      confidenceIssueCount: number;
      coverageGapCount: number;
      historicalBrokerTransfers: number;
      unmatchedTransfers: NetWorthUnmatchedTransfer[];
    };

export interface TransactionRow {
  id: string;
  accountId: string;
  date: string;
  amount: string;
  currency: string;
  merchant: string;
  description: string | null;
  accountName: string;
  categoryId: string | null;
  bucketId: string | null;
  recurringExpenseId: string | null;
  kind: 'NORMAL' | 'INTERNAL_TRANSFER' | 'PENDING_TRANSFER' | 'SETTLEMENT' | 'SPLIT_PARENT';
  isShared: boolean;
  paidBy: 'ME' | 'PARTNER';
  myShareRatio: number | null;
  notes: string | null;
  isSettled: boolean;
  parentId: string | null;
  transferCounterpartyAccount: string | null;
}

export interface TransactionCategory {
  id: string;
  key: string;
  name: string;
  defaultIsShared: boolean;
  isActive: boolean;
  transactionCount: number;
}

export interface TransactionAccountOption {
  id: string;
  name: string;
}

export interface MerchantCategoryRecommendation {
  accountId: string;
  provider: string;
  merchantKey: string;
  merchantLabel: string;
  categoryId: string;
  categoryName: string;
  supportingMonths: number;
  evidenceMonths: number;
  confidence: number;
  targetIds: string[];
}

export interface TransactionsListResponse {
  period: { value: string; from: string | null; to: string | null };
  page: number;
  pageSize: number;
  totalCount: number;
  totalPages: number;
  balance: string;
  income: string;
  expenses: string;
  transactions: TransactionRow[];
  categories: TransactionCategory[];
  accounts: TransactionAccountOption[];
  recommendations: MerchantCategoryRecommendation[];
  unmatchedTransfersOnly: boolean;
  sort: 'date' | 'amount';
  direction: 'asc' | 'desc';
}

export type VehicleCategory = 'CAR' | 'MOTORCYCLE' | 'TRUCK_OR_TRACTOR' | 'MOPED' | 'BUS' | 'TRAILER' | 'OTHER';
export type PaymentFrequency = 'ANNUAL' | 'SEMI_ANNUAL' | 'MONTHLY';
export type PolicyStatus = 'ACTIVE' | 'PAID' | 'PENDING_RENEWAL' | 'TERMINATED';

export interface InsuranceDocumentInfo {
  id: string;
  filename: string;
  uploadedAt: string;
}

export interface InsurancePolicyRow {
  id: string;
  vehicleName: string;
  licensePlate: string;
  policyNumber: string;
  policyHolder: string;
  vehicleType: VehicleCategory;
  annualCost: string;
  paymentFrequency: PaymentFrequency;
  startDate: string;
  status: PolicyStatus;
  documents: { contract: InsuranceDocumentInfo | null; greenCard: InsuranceDocumentInfo | null };
}

export interface InsuranceOverview {
  /** Sum of `annualCost` across accruing (ACTIVE/PENDING_RENEWAL) policies. */
  annualCostTotal: string;
}

export interface InsuranceListResponse {
  policies: InsurancePolicyRow[];
  // Only annualCostTotal is read on mobile so far — the rest of the API's
  // dashboard-style renewal overview isn't rendered in this pass.
  overview: InsuranceOverview & Record<string, unknown>;
}

export interface InsurancePolicyInput {
  vehicleName: string;
  licensePlate: string;
  policyNumber: string;
  policyHolder: string;
  vehicleType: VehicleCategory;
  annualCost: string;
  paymentFrequency: PaymentFrequency;
  startDate: string;
  status: PolicyStatus;
}

export type AccountType = 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT';
export type AccountProvider = 'MONETA' | 'REVOLUT' | 'TRADING212' | 'MANUAL';

export interface AccountCreditDetails {
  limit: string;
  debt: string;
  capacity: string;
  asOf: string | null;
  invalidCapacitySnapshot: boolean;
}

export interface AccountRow {
  id: string;
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
  isArchived: boolean;
  transactionCount: number;
  creditDetails: AccountCreditDetails | null;
  creditNeedsOpeningConfirmation: boolean;
}

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

export interface PlanningSettingsInfo {
  monthlySpendingTarget: string | null;
  transferHistoryFrom: string | null;
  hideHistoricalBrokerTransfers: boolean;
}

export interface InvestmentPlanRow {
  id: string;
  name: string;
  sourceAccountId: string | null;
  sourceAccountName: string | null;
  brokerAccountId: string;
  brokerAccountName: string;
  expectedAmount: string;
  currency: string;
  dueDay: number;
  graceDays: number;
  isActive: boolean;
  startsOn: string | null;
  endsOn: string | null;
}

export interface IncomeSourceRuleRow {
  id: string;
  name: string;
  merchantKey: string;
  accountId: string | null;
  accountName: string | null;
  isActive: boolean;
}

export interface RecurringExpenseRow {
  id: string;
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
  paymentAccountName: string | null;
  transactionCount: number;
}

export interface PlanningAccountOption {
  id: string;
  name: string;
  type: AccountType;
  provider: AccountProvider;
  currency: string;
}

export interface PlanningResponse {
  settings: PlanningSettingsInfo | null;
  firstBankBatchPeriodFrom: string | null;
  plans: InvestmentPlanRow[];
  accounts: PlanningAccountOption[];
  incomeSourceRules: IncomeSourceRuleRow[];
  expenses: RecurringExpenseRow[];
  categories: { id: string; name: string }[];
}

// ---------------------------------------------------------------------------
// Settlement
// ---------------------------------------------------------------------------

export interface SettlementLine {
  id: string;
  date: string;
  merchant: string;
  total: string;
  paidBy: 'ME' | 'PARTNER';
  myShare: string | null;
  partnerShare: string | null;
  currency: string;
  kind: 'EXPENSE' | 'SETTLEMENT' | 'UNCONVERTED';
}

export interface SettlementSummary {
  paidByMe: string;
  paidByPartner: string;
  dueFromMe: string | null;
  dueFromPartner: string | null;
  settlementReceived: string | null;
  settlementSent: string | null;
  balance: string;
  exactBalance: string | null;
  direction: string;
  sharedCount: number;
}

export interface SettlementResponse {
  period: { year: number; month: number };
  isClosed: boolean;
  closedId: string | null;
  settledAt: string | null;
  closedNotes: string | null;
  summary: SettlementSummary;
  lines: SettlementLine[];
  lockedCount: number;
  unconvertedCount: number;
  months: string[];
  history: { id: string; period: string; balance: string; settledAt: string | null }[];
}

// ---------------------------------------------------------------------------
// Portfolio
// ---------------------------------------------------------------------------

export interface PortfolioSnapshot {
  accountName: string;
  currency: string;
  /** Raw Trading 212 provider payload (positions + summary) — parse with lib/portfolio-parse.ts, never trust its shape directly. */
  rawData: unknown;
  balance: string;
  balanceCzk: string | null;
  investedValue: string | null;
  unrealizedPnl: string | null;
  cashBalance: string | null;
  capturedAt: string;
  updatedAt: string;
}

export interface PortfolioResponse {
  snapshots: PortfolioSnapshot[];
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

export interface SettingsResponse {
  reportingStartMonth: string | null;
  availableMonths: string[];
}

// ---------------------------------------------------------------------------
// Users / invites
// ---------------------------------------------------------------------------

export interface HouseholdUserRow {
  id: string;
  email: string;
  name: string | null;
  role: 'OWNER' | 'MEMBER';
  isActive: boolean;
  lastLogin: string | null;
  isCurrentUser: boolean;
}

export interface UsersResponse {
  isOwner: boolean;
  users: HouseholdUserRow[];
}

export interface InviteRow {
  id: string;
  email: string;
  role: 'OWNER' | 'MEMBER';
  expiresAt: string;
  acceptedAt: string | null;
  createdAt: string;
}

export interface InvitesListResponse {
  invites: InviteRow[];
}

export interface CreatedInvite {
  id: string;
  email: string;
  url: string;
  expiresAt: string;
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

export interface ImportAccountOption {
  id: string;
  name: string;
  externalId: string | null;
}

export interface ImportBatchRow {
  id: string;
  createdAt: string;
  status: string;
  account: { name: string };
}

export interface ImportBatchesResponse {
  accounts: ImportAccountOption[];
  batches: ImportBatchRow[];
}

export interface ImportRowPreview {
  externalId: string | null;
  date: string;
  amount: string;
  currency: string;
  merchant: string | null;
  sourceCategory: string | null;
  mappedCategory: string | null;
  internalTransfer: boolean;
  duplicate: boolean;
}

// ---------------------------------------------------------------------------
// Fuel
// ---------------------------------------------------------------------------

export interface FuelMonthlyPurchase {
  id: string;
  purchasedAt: string;
  amountCzk: string;
  quantityLiters: string;
  stationName: string;
  missingReceipt: boolean;
}

export interface FuelMonthlyRow {
  month: string;
  totalCzk: string;
  liters: string;
  purchases: FuelMonthlyPurchase[];
}

export interface FuelReceiptRow {
  id: string;
  purchasedAt: string;
  stationName: string | null;
  totalAfterDiscount: string;
  discountAmount: string;
  matched: boolean;
}

export interface FuelOverview {
  monthly: FuelMonthlyRow[];
  walletBalanceCzk: string;
  topUpCount: number;
  purchaseCount: number;
  totalDiscountCzk: string;
  receiptCount: number;
}

export interface FuelResponse {
  overview: FuelOverview;
  receipts: FuelReceiptRow[];
}
