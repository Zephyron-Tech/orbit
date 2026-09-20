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
  actions: DashboardAction[];
  burnRate: { total: string; target: string | null; targetDifference: SignedMoney | null; spendingTargetProgress: number | null };
  recurringExpenses: DashboardRecurringExpense[];
}

export interface NetWorthCardAccount {
  id: string;
  name: string;
  type: string;
  provider: string;
  balance: string;
  source: string;
  asOf: string | null;
  incomplete: boolean;
  creditLimit: string | null;
  annualInterestRate: string | null;
  interestTaxRate: string | null;
  emergencyReserveMonths: number | null;
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
}
