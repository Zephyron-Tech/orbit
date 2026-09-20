import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { calculateBurnRate, type BurnRateTransaction, type RecurringExpenseInput } from './burn-rate';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

type TxOverrides = Partial<Omit<BurnRateTransaction, 'recurringExpenseId' | 'amountCzk'>> & {
  recurringExpenseId: string | null;
  amountCzk: string;
};

function tx(overrides: TxOverrides): BurnRateTransaction {
  return {
    recurringExpenseId: overrides.recurringExpenseId,
    amountCzk: d(overrides.amountCzk),
    date: overrides.date ?? new Date('2026-07-15T00:00:00Z'),
    kind: overrides.kind ?? 'NORMAL',
    isShared: overrides.isShared ?? false,
    myShareRatio: overrides.myShareRatio ?? null,
  };
}

function expense(overrides: Partial<RecurringExpenseInput> & { id: string; name: string }): RecurringExpenseInput {
  return { id: overrides.id, name: overrides.name, isActive: overrides.isActive ?? true };
}

describe('calculateBurnRate', () => {
  it('sums a tagged expense, shared 50/50 by default treatment', () => {
    // Real July case: rent -18200, tagged, shared with a 0.5 ratio.
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: 'rent', amountCzk: '-18200', isShared: true, myShareRatio: d('0.5') })],
      [expense({ id: 'rent', name: 'Nájem' })],
    );

    expect(result.total.toString()).toBe('18200');
    expect(result.myShare.toString()).toBe('9100');
    expect(result.lines).toHaveLength(1);
    expect(result.lines[0]).toMatchObject({ actual: expect.anything(), transactionCount: 1 });
    expect(result.missing).toEqual([]);
  });

  it('takes the whole amount as my share when not shared', () => {
    // A personal subscription, not split with the partner.
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: 'spotify', amountCzk: '-179', isShared: false })],
      [expense({ id: 'spotify', name: 'Spotify' })],
    );

    expect(result.total.toString()).toBe('179');
    expect(result.myShare.toString()).toBe('179');
  });

  it('sums multiple transactions tagged to the same expense', () => {
    const result = calculateBurnRate(
      [
        tx({ recurringExpenseId: 'electricity', amountCzk: '-1500' }),
        tx({ recurringExpenseId: 'electricity', amountCzk: '-300', date: new Date('2026-07-20T00:00:00Z') }),
      ],
      [expense({ id: 'electricity', name: 'Elektřina' })],
    );

    expect(result.total.toString()).toBe('1800');
    expect(result.lines[0]?.transactionCount).toBe(2);
  });

  it('names an active expense with no transaction this month as missing', () => {
    const result = calculateBurnRate([], [expense({ id: 'rent', name: 'Nájem' })]);

    expect(result.missing).toEqual([{ recurringExpenseId: 'rent', name: 'Nájem' }]);
    expect(result.total.toString()).toBe('0');
  });

  it('ignores an inactive expense entirely, even with a tagged transaction', () => {
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: 'old-gym', amountCzk: '-500' })],
      [expense({ id: 'old-gym', name: 'Staré fitko', isActive: false })],
    );

    expect(result.total.toString()).toBe('0');
    expect(result.missing).toEqual([]);
    expect(result.lines).toEqual([]);
  });

  it('ignores an untagged transaction, however large', () => {
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: null, amountCzk: '-99999' })],
      [expense({ id: 'rent', name: 'Nájem' })],
    );

    expect(result.total.toString()).toBe('0');
    expect(result.missing).toEqual([{ recurringExpenseId: 'rent', name: 'Nájem' }]);
  });

  it('excludes a split parent, the same way settlement does', () => {
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: 'rent', amountCzk: '-18200', kind: 'SPLIT_PARENT' })],
      [expense({ id: 'rent', name: 'Nájem' })],
    );

    expect(result.total.toString()).toBe('0');
    expect(result.missing).toEqual([{ recurringExpenseId: 'rent', name: 'Nájem' }]);
  });

  it('excludes an internal transfer and a settlement repayment', () => {
    const result = calculateBurnRate(
      [
        tx({ recurringExpenseId: 'rent', amountCzk: '-1000', kind: 'INTERNAL_TRANSFER' }),
        tx({ recurringExpenseId: 'rent', amountCzk: '-1000', kind: 'SETTLEMENT' }),
      ],
      [expense({ id: 'rent', name: 'Nájem' })],
    );

    expect(result.total.toString()).toBe('0');
  });

  it('ignores income, even if someone tagged it to a recurring expense', () => {
    const result = calculateBurnRate(
      [tx({ recurringExpenseId: 'rent', amountCzk: '18200' })],
      [expense({ id: 'rent', name: 'Nájem' })],
    );

    expect(result.total.toString()).toBe('0');
  });

  it('keeps several recurring lines independent', () => {
    const result = calculateBurnRate(
      [
        tx({ recurringExpenseId: 'rent', amountCzk: '-18200', isShared: true }),
        tx({ recurringExpenseId: 'spotify', amountCzk: '-179' }),
      ],
      [expense({ id: 'rent', name: 'Nájem' }), expense({ id: 'spotify', name: 'Spotify' })],
    );

    expect(result.total.toString()).toBe('18379');
    expect(result.lines).toHaveLength(2);
    expect(result.missing).toEqual([]);
  });

  it('handles no active recurring expenses at all', () => {
    expect(calculateBurnRate([], [])).toEqual({ total: d('0'), myShare: d('0'), lines: [], missing: [] });
  });
});
