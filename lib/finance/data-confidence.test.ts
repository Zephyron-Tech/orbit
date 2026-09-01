import { Prisma } from '@/lib/generated/prisma/client';
import { describe, expect, it } from 'vitest';

import { countIncompleteOrUnknown, findCheckpointIssues, isActionableTransfer, totalDataConfidenceIssues } from './data-confidence';

describe('countIncompleteOrUnknown', () => {
  it('counts an account once even when it trips both flags', () => {
    const result = countIncompleteOrUnknown([
      { accountId: 'a', name: 'A', incompleteHistory: true, source: 'UNKNOWN' },
      { accountId: 'b', name: 'B', incompleteHistory: true, source: 'CHECKPOINT' },
      { accountId: 'c', name: 'C', incompleteHistory: false, source: 'SNAPSHOT' },
    ]);

    expect(result).toHaveLength(2);
    expect(result.map((a) => a.accountId)).toEqual(['a', 'b']);
  });
});

describe('findCheckpointIssues', () => {
  it('flags an account with no checkpoint at all', () => {
    const result = findCheckpointIssues([{ accountId: 'a', name: 'A', latestSnapshot: null }]);

    expect(result).toHaveLength(1);
  });

  it('flags a checkpoint that does not reconcile against the ledger prediction', () => {
    const result = findCheckpointIssues([
      { accountId: 'a', name: 'A', latestSnapshot: { balance: new Prisma.Decimal('100'), expectedBalance: new Prisma.Decimal('90') } },
    ]);

    expect(result).toHaveLength(1);
  });

  it('does not flag a checkpoint that reconciles exactly', () => {
    const result = findCheckpointIssues([
      { accountId: 'a', name: 'A', latestSnapshot: { balance: new Prisma.Decimal('100'), expectedBalance: new Prisma.Decimal('100') } },
    ]);

    expect(result).toHaveLength(0);
  });

  it('does not flag a checkpoint with no expected balance to compare against', () => {
    const result = findCheckpointIssues([
      { accountId: 'a', name: 'A', latestSnapshot: { balance: new Prisma.Decimal('100'), expectedBalance: null } },
    ]);

    expect(result).toHaveLength(0);
  });
});

describe('isActionableTransfer', () => {
  it('always counts a non-T212 transfer', () => {
    expect(isActionableTransfer({ date: new Date('2020-01-01'), provider: 'MONETA' }, new Date('2026-01-01'))).toBe(true);
  });

  it('excludes a T212 transfer older than the tracked bank history', () => {
    expect(isActionableTransfer({ date: new Date('2020-01-01'), provider: 'TRADING212' }, new Date('2026-01-01'))).toBe(false);
  });

  it('counts a T212 transfer within the tracked window', () => {
    expect(isActionableTransfer({ date: new Date('2026-06-01'), provider: 'TRADING212' }, new Date('2026-01-01'))).toBe(true);
  });

  it('counts a T212 transfer when there is no baseline at all', () => {
    expect(isActionableTransfer({ date: new Date('2020-01-01'), provider: 'TRADING212' }, null)).toBe(true);
  });
});

describe('totalDataConfidenceIssues', () => {
  it('sums every signal — this is the one place both /dashboard and /net-worth compute the total, so they cannot disagree', () => {
    expect(
      totalDataConfidenceIssues({ incompleteOrUnknown: 1, coverageGaps: 2, actionableTransfers: 3, checkpointIssues: 4 }),
    ).toBe(10);
  });
});
