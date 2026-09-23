import { describe, expect, it } from 'vitest';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

import { findUnmatchedDcaPlans, splitOverdueDcaPlans, type DcaMatchTransaction, type DcaPlanInput } from './dca';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function plan(overrides: Partial<DcaPlanInput> & { id: string }): DcaPlanInput {
  return {
    id: overrides.id,
    sourceAccountId: overrides.sourceAccountId ?? 'checking-1',
    brokerAccountId: overrides.brokerAccountId ?? 'broker-1',
    expectedAmount: overrides.expectedAmount ?? d('5000'),
    currency: overrides.currency ?? 'CZK',
    dueDay: overrides.dueDay ?? 10,
    graceDays: overrides.graceDays ?? 3,
  };
}

describe('findUnmatchedDcaPlans', () => {
  it('matches a plan whose transfer has the right broker/source legs and exact amount', () => {
    const transactions: DcaMatchTransaction[] = [
      {
        transferId: 't1',
        transfer: {
          legs: [
            { accountId: 'checking-1', amount: d('-5000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
            { accountId: 'broker-1', amount: d('5000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
          ],
        },
      },
    ];

    expect(findUnmatchedDcaPlans([plan({ id: 'p1' })], transactions)).toEqual([]);
  });

  it('leaves a plan unmatched when no transfer has the exact expected amount', () => {
    const transactions: DcaMatchTransaction[] = [
      {
        transferId: 't1',
        transfer: {
          legs: [
            { accountId: 'checking-1', amount: d('-4000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
            { accountId: 'broker-1', amount: d('4000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
          ],
        },
      },
    ];

    expect(findUnmatchedDcaPlans([plan({ id: 'p1' })], transactions)).toEqual([plan({ id: 'p1' })]);
  });

  it('does not let two plans claim the same transfer', () => {
    const transactions: DcaMatchTransaction[] = [
      {
        transferId: 't1',
        transfer: {
          legs: [
            { accountId: 'checking-1', amount: d('-5000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
            { accountId: 'broker-1', amount: d('5000'), currency: 'CZK', kind: 'INTERNAL_TRANSFER' },
          ],
        },
      },
    ];

    const plans = [plan({ id: 'p1' }), plan({ id: 'p2' })];
    const unmatched = findUnmatchedDcaPlans(plans, transactions);
    expect(unmatched.map((p) => p.id)).toEqual(['p2']);
  });
});

describe('splitOverdueDcaPlans', () => {
  it('splits by dueDay + graceDays against todayDay', () => {
    const plans = [plan({ id: 'overdue', dueDay: 5, graceDays: 2 }), plan({ id: 'pending', dueDay: 20, graceDays: 2 })];
    const { overdue, pending } = splitOverdueDcaPlans(plans, 10, 30);
    expect(overdue.map((p) => p.id)).toEqual(['overdue']);
    expect(pending.map((p) => p.id)).toEqual(['pending']);
  });

  it('caps dueDay at periodEndDay for a short month', () => {
    // dueDay 45 in a 30-day month effectively means "due the 30th" — without
    // the cap this plan would never be overdue (45 > todayDay for any real day).
    const plans = [plan({ id: 'p1', dueDay: 45, graceDays: 0 })];
    const { overdue } = splitOverdueDcaPlans(plans, 31, 30);
    expect(overdue.map((p) => p.id)).toEqual(['p1']);
  });
});
