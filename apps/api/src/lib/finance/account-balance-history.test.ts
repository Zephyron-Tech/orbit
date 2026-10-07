import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { buildAccountBalanceHistory } from './account-balance-history';

function decimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

describe('buildAccountBalanceHistory', () => {
  it('reads balance from each historical snapshot entry and appends a live point', () => {
    const result = buildAccountBalanceHistory(
      [
        { date: new Date('2026-09-01T00:00:00Z'), balance: '10000.00' },
        { date: new Date('2026-09-15T00:00:00Z'), balance: '10050.00' },
      ],
      [],
      { date: new Date('2026-09-20T12:00:00Z'), balanceCzk: decimal('10200.00') },
    );

    expect(result).toEqual([
      { date: '2026-09-01', balance: 10000, cumulativeInterest: 0 },
      { date: '2026-09-15', balance: 10050, cumulativeInterest: 0 },
      { date: '2026-09-20', balance: 10200, cumulativeInterest: 0 },
    ]);
  });

  it('accumulates interest earned up to each point, not just the total', () => {
    const result = buildAccountBalanceHistory(
      [
        { date: new Date('2026-09-01T00:00:00Z'), balance: '10000.00' },
        { date: new Date('2026-09-15T00:00:00Z'), balance: '10012.50' },
      ],
      [
        { date: new Date('2026-09-05T00:00:00Z'), amountCzk: decimal('7.50') },
        { date: new Date('2026-09-12T00:00:00Z'), amountCzk: decimal('5.00') },
      ],
      { date: new Date('2026-09-20T00:00:00Z'), balanceCzk: decimal('10012.50') },
    );

    // The 1 Sept point predates both interest postings.
    expect(result[0]?.cumulativeInterest).toBe(0);
    // The 15 Sept point is after both the 5 Sept and 12 Sept postings.
    expect(result[1]?.cumulativeInterest).toBe(12.5);
    // The live point (20 Sept) sees everything too.
    expect(result[2]?.cumulativeInterest).toBe(12.5);
  });

  it('returns only the live point when there is no snapshot history yet', () => {
    const result = buildAccountBalanceHistory([], [], { date: new Date('2026-09-20T00:00:00Z'), balanceCzk: decimal('500.00') });

    expect(result).toEqual([{ date: '2026-09-20', balance: 500, cumulativeInterest: 0 }]);
  });
});
