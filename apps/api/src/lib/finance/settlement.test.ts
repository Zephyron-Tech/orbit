import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import {
  calculateSettlement,
  describeBalance,
  monthPeriod,
  SettlementInputError,
  type SettleableTransaction,
} from './settlement';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

type TxOverrides = Partial<Omit<SettleableTransaction, 'id' | 'amountCzk'>> & { id: string; amountCzk: string };

function tx(overrides: TxOverrides): SettleableTransaction {
  return {
    id: overrides.id,
    amountCzk: d(overrides.amountCzk),
    isShared: overrides.isShared ?? false,
    paidBy: overrides.paidBy ?? 'ME',
    myShareRatio: overrides.myShareRatio ?? null,
    kind: overrides.kind ?? 'NORMAL',
    settlementId: overrides.settlementId ?? null,
  };
}

describe('calculateSettlement', () => {
  it('splits an evenly shared expense I paid', () => {
    const result = calculateSettlement([tx({ id: 'a', amountCzk: '-1000', isShared: true, paidBy: 'ME' })]);

    expect(result.paidByMe.toString()).toBe('1000');
    expect(result.dueFromMe.toString()).toBe('500');
    expect(result.dueFromPartner.toString()).toBe('500');
    expect(result.balance.toString()).toBe('500');
    expect(describeBalance(result.balance)).toBe('PARTNER_OWES_ME');
  });

  it('respects an uneven ratio, which is MY share not the payer share', () => {
    // I owe 60 %, so of a 1000 expense I paid, the partner owes me 400.
    const result = calculateSettlement([
      tx({ id: 'a', amountCzk: '-1000', isShared: true, paidBy: 'ME', myShareRatio: d('0.6') }),
    ]);

    expect(result.dueFromMe.toString()).toBe('600');
    expect(result.balance.toString()).toBe('400');
  });

  it('flips the direction when the partner paid', () => {
    const result = calculateSettlement([tx({ id: 'a', amountCzk: '-1000', isShared: true, paidBy: 'PARTNER' })]);

    expect(result.paidByPartner.toString()).toBe('1000');
    expect(result.balance.toString()).toBe('-500');
    expect(describeBalance(result.balance)).toBe('I_OWE_PARTNER');
  });

  it('nets out when both paid their own share', () => {
    const result = calculateSettlement([
      tx({ id: 'a', amountCzk: '-1000', isShared: true, paidBy: 'ME' }),
      tx({ id: 'b', amountCzk: '-1000', isShared: true, paidBy: 'PARTNER' }),
    ]);

    expect(result.balance.toString()).toBe('0');
    expect(describeBalance(result.balance)).toBe('EVEN');
  });

  it('ignores transactions that are not shared', () => {
    const result = calculateSettlement([tx({ id: 'a', amountCzk: '-5000' })]);

    expect(result.balance.toString()).toBe('0');
    expect(result.transactionIds).toHaveLength(0);
  });

  it('ignores income, because only costs are split', () => {
    const result = calculateSettlement([tx({ id: 'a', amountCzk: '25000', isShared: true, paidBy: 'ME' })]);

    expect(result.balance.toString()).toBe('0');
  });

  it('ignores transfers between our own accounts', () => {
    // The real case: 13 700 moved from savings to the current account.
    const result = calculateSettlement([
      tx({ id: 'out', amountCzk: '-13700', kind: 'INTERNAL_TRANSFER', isShared: true }),
      tx({ id: 'in', amountCzk: '13700', kind: 'INTERNAL_TRANSFER', isShared: true }),
    ]);

    expect(result.balance.toString()).toBe('0');
    expect(result.transactionIds).toHaveLength(0);
  });

  it('ignores a split parent; only its children count', () => {
    // -908.50 split into -700 groceries (shared) and -208.50 personal (not shared).
    const result = calculateSettlement([
      tx({ id: 'parent', amountCzk: '-908.50', kind: 'SPLIT_PARENT', isShared: true }),
      tx({ id: 'groceries', amountCzk: '-700', isShared: true, paidBy: 'ME' }),
      tx({ id: 'personal', amountCzk: '-208.50', isShared: false }),
    ]);

    expect(result.transactionIds).toEqual(['groceries']);
    expect(result.balance.toString()).toBe('350');
  });

  it('treats a payment from the partner as repayment, not income', () => {
    // Rent 18 200 paid by me, split evenly; the partner already sent 9 100.
    const result = calculateSettlement([
      tx({ id: 'rent', amountCzk: '-18200', isShared: true, paidBy: 'ME' }),
      tx({ id: 'paid', amountCzk: '9100', kind: 'SETTLEMENT' }),
    ]);

    expect(result.dueFromPartner.toString()).toBe('9100');
    expect(result.settlementReceived.toString()).toBe('9100');
    expect(result.balance.toString()).toBe('0');
  });

  it('counts a settlement payment I sent', () => {
    const result = calculateSettlement([
      tx({ id: 'shared', amountCzk: '-1000', isShared: true, paidBy: 'PARTNER' }),
      tx({ id: 'sent', amountCzk: '-500', kind: 'SETTLEMENT' }),
    ]);

    expect(result.settlementSent.toString()).toBe('500');
    expect(result.balance.toString()).toBe('0');
  });

  it('never settles the same transaction twice', () => {
    const result = calculateSettlement([
      tx({ id: 'old', amountCzk: '-1000', isShared: true, paidBy: 'ME', settlementId: 'closed-period' }),
      tx({ id: 'new', amountCzk: '-400', isShared: true, paidBy: 'ME' }),
    ]);

    expect(result.balance.toString()).toBe('200');
    expect(result.transactionIds).toEqual(['new']);
  });

  it('rounds once at the end, not per line', () => {
    // Three thirds of 0.01 would each round to 0.01 and drift upwards.
    const result = calculateSettlement([
      tx({ id: 'a', amountCzk: '-33.33', isShared: true, paidBy: 'ME' }),
      tx({ id: 'b', amountCzk: '-33.33', isShared: true, paidBy: 'ME' }),
      tx({ id: 'c', amountCzk: '-33.34', isShared: true, paidBy: 'ME' }),
    ]);

    expect(result.exactBalance.toString()).toBe('50');
    expect(result.balance.toString()).toBe('50');
  });

  it('keeps the exact balance alongside the rounded one', () => {
    const result = calculateSettlement([tx({ id: 'a', amountCzk: '-100.51', isShared: true, paidBy: 'ME' })]);

    expect(result.exactBalance.toString()).toBe('50.255');
    expect(result.balance.toString()).toBe('50');
  });

  it('defaults to an even split when a shared transaction has no ratio', () => {
    const result = calculateSettlement([
      tx({ id: 'a', amountCzk: '-200', isShared: true, paidBy: 'ME', myShareRatio: null }),
    ]);

    expect(result.dueFromMe.toString()).toBe('100');
  });

  it('handles a ratio of 1, where the cost is entirely mine', () => {
    const result = calculateSettlement([
      tx({ id: 'a', amountCzk: '-500', isShared: true, paidBy: 'ME', myShareRatio: d('1') }),
    ]);

    expect(result.balance.toString()).toBe('0');
  });

  it('rejects a ratio outside 0–1', () => {
    expect(() =>
      calculateSettlement([tx({ id: 'a', amountCzk: '-100', isShared: true, myShareRatio: d('1.5') })]),
    ).toThrow(SettlementInputError);
  });

  it('reproduces the real July rent case', () => {
    // Rent 18 200 paid from my account; the partner's 9 500 arrived on savings.
    const result = calculateSettlement([
      tx({ id: 'rent', amountCzk: '-18200', isShared: true, paidBy: 'ME', myShareRatio: d('0.5') }),
      tx({ id: 'dana', amountCzk: '9500', kind: 'SETTLEMENT' }),
    ]);

    expect(result.dueFromPartner.toString()).toBe('9100');
    expect(result.balance.toString()).toBe('-400');
    // She sent 400 more than her half, so that much comes back to her.
    expect(describeBalance(result.balance)).toBe('I_OWE_PARTNER');
  });
});

describe('monthPeriod', () => {
  it('produces a half-open UTC range', () => {
    const { from, to } = monthPeriod(2026, 7);

    expect(from.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(to.toISOString()).toBe('2026-08-01T00:00:00.000Z');
  });

  it('rolls over at the end of the year', () => {
    expect(monthPeriod(2026, 12).to.toISOString()).toBe('2027-01-01T00:00:00.000Z');
  });

  it('rejects an impossible month', () => {
    expect(() => monthPeriod(2026, 13)).toThrow(SettlementInputError);
  });
});
