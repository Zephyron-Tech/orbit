import { Prisma } from '@/lib/generated/prisma/client';
import type { TransactionKind } from '@/lib/generated/prisma/enums';

/**
 * Net worth aggregation. Pure: inputs in, numbers out. No Prisma, no fetch, no
 * clock — the caller supplies everything, including the moment in time.
 *
 * Two kinds of account are combined, because they are knowable in two different
 * ways:
 *   - cash accounts, whose balance is an opening figure plus every transaction
 *     booked since (a bank statement carries no running balance);
 *   - investment accounts, whose value moves with the market and is therefore
 *     sampled into snapshots rather than derived.
 */

const ZERO = new Prisma.Decimal(0);

export type NetWorthAccountType = 'CHECKING' | 'SAVINGS' | 'INVESTMENT' | 'CREDIT';

export interface NetWorthAccount {
  id: string;
  name: string;
  type: NetWorthAccountType;
  currency: string;
  includeInNetWorth: boolean;
}

export interface NetWorthTransaction {
  accountId: string;
  date: Date;
  amountCzk: Prisma.Decimal;
  kind: TransactionKind;
}

/**
 * A known balance at a point in time: either read from a provider API or typed
 * in by a person from their banking app.
 */
export interface NetWorthSnapshotInput {
  accountId: string;
  capturedAt: Date;
  balanceCzk: Prisma.Decimal | null;
}

export interface AccountBalance {
  accountId: string;
  name: string;
  type: NetWorthAccountType;
  balance: Prisma.Decimal;
  /** How the figure was arrived at, so the UI can be honest about it. */
  source: 'TRANSACTIONS' | 'CHECKPOINT' | 'SNAPSHOT' | 'UNKNOWN';
  asOf: Date | null;
  /**
   * True when a cash account has no opening balance recorded, so its figure is
   * only the sum of whatever statements happen to have been imported. The total
   * is then a lower bound, not the real balance, and the UI must say so.
   */
  incompleteHistory: boolean;
}

export interface NetWorthResult {
  totalWorth: Prisma.Decimal;
  cashValue: Prisma.Decimal;
  investmentValue: Prisma.Decimal;
  /** Debt, as a positive number. */
  liabilityValue: Prisma.Decimal;
  accounts: AccountBalance[];
}

/**
 * Balance of a cash account: the newest checkpoint plus every transaction
 * booked after it.
 *
 * A statement export carries only movements, never a running balance, so the
 * total has to be anchored by a figure a person read from their banking app.
 * Each new checkpoint re-anchors it, which is what makes the number
 * self-correcting rather than drifting forever after one missed import.
 *
 * Transfers between our own accounts are **not** skipped here. They net to zero
 * across the household but they genuinely move one account's balance, so each
 * side must count on its own account.
 *
 * A split parent **is** skipped: its children carry the money now (see
 * `lib/finance/split.ts`), and summing both would double it.
 */
export function calculateAccountBalance(
  account: NetWorthAccount,
  transactions: readonly NetWorthTransaction[],
  checkpoint?: NetWorthSnapshotInput,
): Prisma.Decimal {
  const anchorAt = checkpoint?.capturedAt ?? null;
  const anchorBalance = checkpoint?.balanceCzk ?? ZERO;

  return transactions
    .filter((transaction) => transaction.accountId === account.id)
    .filter((transaction) => transaction.kind !== 'SPLIT_PARENT')
    // Strictly after: a checkpoint stores the end of its day, so that day's
    // transactions are already reflected in the figure the bank showed.
    .filter((transaction) => anchorAt === null || transaction.date.getTime() > anchorAt.getTime())
    .reduce((sum, transaction) => sum.plus(transaction.amountCzk), anchorBalance);
}

/** Most recent snapshot per account, by capture time. */
export function latestSnapshotByAccount(
  snapshots: readonly NetWorthSnapshotInput[],
): Map<string, NetWorthSnapshotInput> {
  const latest = new Map<string, NetWorthSnapshotInput>();

  for (const snapshot of snapshots) {
    const current = latest.get(snapshot.accountId);

    if (!current || snapshot.capturedAt.getTime() > current.capturedAt.getTime()) {
      latest.set(snapshot.accountId, snapshot);
    }
  }

  return latest;
}

export function calculateNetWorth(
  accounts: readonly NetWorthAccount[],
  transactions: readonly NetWorthTransaction[],
  snapshots: readonly NetWorthSnapshotInput[],
): NetWorthResult {
  const latest = latestSnapshotByAccount(snapshots);

  let cashValue = ZERO;
  let investmentValue = ZERO;
  let liabilityValue = ZERO;

  const balances: AccountBalance[] = [];

  for (const account of accounts) {
    if (!account.includeInNetWorth) {
      continue;
    }

    const snapshot = latest.get(account.id);
    // Card availability is sometimes entered as a positive "balance". That is
    // unused credit capacity, not a household asset or a debt anchor. CREDIT
    // accounts accept only zero/negative balance anchors; otherwise their debt
    // derives from the imported card movements.
    const usableSnapshot =
      snapshot?.balanceCzk && (account.type !== 'CREDIT' || snapshot.balanceCzk.lessThanOrEqualTo(0))
        ? snapshot
        : undefined;

    // An investment account is only as good as its last snapshot. Falling back
    // to a transaction sum would report a confidently wrong number.
    const useSnapshot = account.type === 'INVESTMENT';

    const balance = useSnapshot
      ? (usableSnapshot?.balanceCzk ?? ZERO)
      : calculateAccountBalance(account, transactions, usableSnapshot);

    const source: AccountBalance['source'] = useSnapshot
      ? usableSnapshot?.balanceCzk
        ? 'SNAPSHOT'
        : 'UNKNOWN'
      : usableSnapshot
        ? 'CHECKPOINT'
        : 'TRANSACTIONS';

    balances.push({
      accountId: account.id,
      name: account.name,
      type: account.type,
      balance,
      source,
      asOf: usableSnapshot?.capturedAt ?? null,
      // Without an anchor the figure is only the sum of whatever statements
      // happen to have been imported, which is a lower bound, not a balance.
      incompleteHistory: !useSnapshot && usableSnapshot === undefined,
    });

    if (account.type === 'INVESTMENT') {
      investmentValue = investmentValue.plus(balance);
    } else if (account.type === 'CREDIT') {
      // A credit limit is configuration, never a balance. Negative balance is
      // debt; a positive refund/overpayment is a real household asset.
      if (balance.isNegative()) {
        liabilityValue = liabilityValue.plus(balance.abs());
      }
    } else {
      cashValue = cashValue.plus(balance);
    }
  }

  return {
    totalWorth: cashValue.plus(investmentValue).minus(liabilityValue),
    cashValue,
    investmentValue,
    liabilityValue,
    accounts: balances,
  };
}

/** End of a calendar day in UTC — the instant a checkpoint is true as of. */
export function endOfDayUtc(date: Date): Date {
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);

  return end;
}

export interface ReconciliationResult {
  /** What the balance should have been, from the previous anchor plus movements. */
  expected: Prisma.Decimal | null;
  actual: Prisma.Decimal;
  /** actual − expected. Zero proves the imported statements are complete. */
  difference: Prisma.Decimal | null;
  matches: boolean;
}

/**
 * Compares a newly entered balance against what the ledger predicted.
 *
 * This is the point of asking for the number at all: a match is evidence that
 * every statement has been imported and the parser is reading it correctly, and
 * a mismatch names the exact amount that is unaccounted for.
 */
export function reconcileCheckpoint(
  account: NetWorthAccount,
  transactions: readonly NetWorthTransaction[],
  previous: NetWorthSnapshotInput | undefined,
  entered: { balance: Prisma.Decimal; capturedAt: Date },
): ReconciliationResult {
  if (!previous) {
    return { expected: null, actual: entered.balance, difference: null, matches: true };
  }

  const movements = transactions
    .filter((transaction) => transaction.accountId === account.id)
    .filter((transaction) => transaction.kind !== 'SPLIT_PARENT')
    .filter(
      (transaction) =>
        transaction.date.getTime() > previous.capturedAt.getTime() &&
        transaction.date.getTime() <= entered.capturedAt.getTime(),
    )
    .reduce((sum, transaction) => sum.plus(transaction.amountCzk), ZERO);

  const expected = (previous.balanceCzk ?? ZERO).plus(movements);
  const difference = entered.balance.minus(expected);

  return { expected, actual: entered.balance, difference, matches: difference.isZero() };
}
