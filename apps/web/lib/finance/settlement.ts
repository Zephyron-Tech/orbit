import { Prisma } from '@/lib/generated/prisma/client';
import type { TransactionKind } from '@/lib/generated/prisma/enums';

import { computeMyShare, DEFAULT_SHARE_RATIO, ShareInputError } from './share';

/**
 * Couple settlement for one period. Pure: transactions in, numbers out. No
 * Prisma, no fetch, no clock — the caller supplies everything, so every branch
 * is reachable from a unit test.
 *
 * Convention (see CLAUDE.md): amounts are signed, expenses negative.
 * `myShareRatio` is *my* share of the transaction, not the payer's.
 */

const ZERO = new Prisma.Decimal(0);

/**
 * Same class as `ShareInputError`, under the name this module has always used
 * — both a bad share ratio and an out-of-range month are "the caller gave
 * this pure function data it cannot work with", so one error type covers both.
 */
const SettlementInputError = ShareInputError;
export { SettlementInputError };

/** The only fields settlement needs. Keeps the input decoupled from Prisma rows. */
export interface SettleableTransaction {
  id: string;
  /** Signed amount in the reporting currency. */
  amountCzk: Prisma.Decimal;
  isShared: boolean;
  paidBy: 'ME' | 'PARTNER';
  /** My share, 0–1. Null means the transaction is not split. */
  myShareRatio: Prisma.Decimal | null;
  kind: TransactionKind;
  /** Set once the transaction belongs to a closed settlement. */
  settlementId: string | null;
}

export interface SettlementLine {
  id: string;
  /** Absolute value of the shared expense. */
  total: Prisma.Decimal;
  paidBy: 'ME' | 'PARTNER';
  myShare: Prisma.Decimal;
  partnerShare: Prisma.Decimal;
}

export interface SettlementResult {
  /** Shared expenses I actually paid. */
  paidByMe: Prisma.Decimal;
  /** Shared expenses the partner actually paid. */
  paidByPartner: Prisma.Decimal;
  /** What I owed of the shared expenses. */
  dueFromMe: Prisma.Decimal;
  /** What the partner owed. */
  dueFromPartner: Prisma.Decimal;
  /** Settlement payments the partner already sent me during the period. */
  settlementReceived: Prisma.Decimal;
  /** Settlement payments I already sent the partner. */
  settlementSent: Prisma.Decimal;
  /**
   * Positive = the partner still owes me. Negative = I owe the partner.
   * Rounded to whole crowns, because the closing payment is a bank transfer.
   */
  balance: Prisma.Decimal;
  /** Unrounded balance, for reconciling against the ledger to the haler. */
  exactBalance: Prisma.Decimal;
  lines: SettlementLine[];
  /** Ids of the transactions this settlement covers. */
  transactionIds: string[];
}

/** Re-exported so `myShareRatio ?? DEFAULT_SHARE_RATIO` reads the same everywhere. */
export { DEFAULT_SHARE_RATIO };

/**
 * Computes the balance between the two partners.
 *
 * Only unsettled shared transactions count. `INTERNAL_TRANSFER` is ignored
 * entirely (it is our own money moving between our own accounts), and
 * `SETTLEMENT` rows are not expenses: they repay a balance, so they reduce it
 * rather than creating one.
 */
export function calculateSettlement(transactions: readonly SettleableTransaction[]): SettlementResult {
  let paidByMe = ZERO;
  let paidByPartner = ZERO;
  let dueFromMe = ZERO;
  let dueFromPartner = ZERO;
  let settlementReceived = ZERO;
  let settlementSent = ZERO;

  const lines: SettlementLine[] = [];
  const transactionIds: string[] = [];

  for (const transaction of transactions) {
    // Already closed in an earlier period; counting it again would settle it twice.
    if (transaction.settlementId !== null) {
      continue;
    }

    if (transaction.kind === 'INTERNAL_TRANSFER' || transaction.kind === 'PENDING_TRANSFER') {
      continue;
    }

    // The children carry the money now; counting the parent too would double it.
    if (transaction.kind === 'SPLIT_PARENT') {
      continue;
    }

    if (transaction.kind === 'SETTLEMENT') {
      // Sign tells the direction: positive means it arrived on our side.
      if (transaction.amountCzk.greaterThan(0)) {
        settlementReceived = settlementReceived.plus(transaction.amountCzk);
      } else {
        settlementSent = settlementSent.plus(transaction.amountCzk.abs());
      }

      transactionIds.push(transaction.id);
      continue;
    }

    if (!transaction.isShared) {
      continue;
    }

    // Income is not a shared cost; only spending is split.
    if (transaction.amountCzk.greaterThanOrEqualTo(0)) {
      continue;
    }

    const total = transaction.amountCzk.abs();
    const myShare = computeMyShare(total, transaction.myShareRatio, `Transaction ${transaction.id}`);
    const partnerShare = total.minus(myShare);

    dueFromMe = dueFromMe.plus(myShare);
    dueFromPartner = dueFromPartner.plus(partnerShare);

    if (transaction.paidBy === 'ME') {
      paidByMe = paidByMe.plus(total);
    } else {
      paidByPartner = paidByPartner.plus(total);
    }

    lines.push({ id: transaction.id, total, paidBy: transaction.paidBy, myShare, partnerShare });
    transactionIds.push(transaction.id);
  }

  // What I paid beyond my own share is what the partner owes me, less whatever
  // has already changed hands during the period.
  const exactBalance = paidByMe.minus(dueFromMe).minus(settlementReceived).plus(settlementSent);

  return {
    paidByMe,
    paidByPartner,
    dueFromMe,
    dueFromPartner,
    settlementReceived,
    settlementSent,
    // Round once, at the end. Rounding each line would drift by a few halers.
    balance: exactBalance.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP),
    exactBalance,
    lines,
    transactionIds,
  };
}

/** Half-open UTC month range: [1st of month, 1st of next month). */
export function monthPeriod(year: number, month: number): { from: Date; to: Date } {
  if (month < 1 || month > 12) {
    throw new SettlementInputError(`Month out of range: ${month}`);
  }

  return { from: new Date(Date.UTC(year, month - 1, 1)), to: new Date(Date.UTC(year, month, 1)) };
}

/** Human-readable direction of a balance, for the UI. */
export function describeBalance(balance: Prisma.Decimal): 'PARTNER_OWES_ME' | 'I_OWE_PARTNER' | 'EVEN' {
  if (balance.greaterThan(0)) {
    return 'PARTNER_OWES_ME';
  }

  if (balance.lessThan(0)) {
    return 'I_OWE_PARTNER';
  }

  return 'EVEN';
}
