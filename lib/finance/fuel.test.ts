import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/generated/prisma/client';

import { monthlyFuelSpend, walletBalance } from './fuel';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('monthlyFuelSpend', () => {
  it('groups purchases by UTC calendar month, oldest first', () => {
    const result = monthlyFuelSpend([
      { purchasedAt: new Date('2026-08-20T10:00:00Z'), amountCzk: decimal('1000'), quantityLiters: decimal('20') },
      { purchasedAt: new Date('2026-07-15T10:00:00Z'), amountCzk: decimal('500'), quantityLiters: decimal('10') },
      { purchasedAt: new Date('2026-08-01T10:00:00Z'), amountCzk: decimal('300'), quantityLiters: decimal('6') },
    ]);

    expect(result.map((row) => row.month)).toEqual(['2026-07', '2026-08']);
    expect(result[1]?.totalCzk.toString()).toBe('1300');
    expect(result[1]?.liters.toString()).toBe('26');
  });

  it('returns an empty array for no purchases', () => {
    expect(monthlyFuelSpend([])).toEqual([]);
  });

  it('answers "accurate monthly spend" directly, independent of when top-ups happened', () => {
    // A July top-up funding August driving must not shift August's actual
    // purchases into July's total — grouping is purely by purchase date.
    const result = monthlyFuelSpend([
      { purchasedAt: new Date('2026-08-05T10:00:00Z'), amountCzk: decimal('700'), quantityLiters: decimal('14') },
    ]);

    expect(result).toEqual([{ month: '2026-08', totalCzk: decimal('700'), liters: decimal('14') }]);
  });
});

describe('walletBalance', () => {
  it('is top-ups minus purchases, both all-time', () => {
    const balance = walletBalance([decimal('5000'), decimal('3000')], [decimal('4500'), decimal('1200')]);

    expect(balance.toString()).toBe('2300');
  });

  it('is zero with no top-ups and no purchases', () => {
    expect(walletBalance([], []).toString()).toBe('0');
  });

  it('goes negative when purchases exceed top-ups (a top-up outside the known window)', () => {
    expect(walletBalance([decimal('100')], [decimal('250')]).toString()).toBe('-150');
  });
});
