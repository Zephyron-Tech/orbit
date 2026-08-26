import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/generated/prisma/client';

import {
  calculateAccountBalance,
  calculateNetWorth,
  endOfDayUtc,
  latestSnapshotByAccount,
  reconcileCheckpoint,
  type NetWorthAccount,
  type NetWorthSnapshotInput,
  type NetWorthTransaction,
} from './net-worth';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function account(overrides: Partial<NetWorthAccount> & { id: string }): NetWorthAccount {
  return {
    id: overrides.id,
    name: overrides.name ?? overrides.id,
    type: overrides.type ?? 'CHECKING',
    currency: overrides.currency ?? 'CZK',
    includeInNetWorth: overrides.includeInNetWorth ?? true,
  };
}

function tx(
  accountId: string,
  date: string,
  amount: string,
  kind: NetWorthTransaction['kind'] = 'NORMAL',
): NetWorthTransaction {
  return { accountId, date: new Date(date), amountCzk: d(amount), kind };
}

function checkpoint(accountId: string, day: string, balance: string): NetWorthSnapshotInput {
  return { accountId, capturedAt: endOfDayUtc(new Date(`${day}T00:00:00Z`)), balanceCzk: d(balance) };
}

describe('endOfDayUtc', () => {
  it('anchors a checkpoint at the end of its calendar day', () => {
    expect(endOfDayUtc(new Date('2026-07-31T00:00:00Z')).toISOString()).toBe('2026-07-31T23:59:59.999Z');
  });
});

describe('calculateAccountBalance', () => {
  it('adds transactions booked after the checkpoint', () => {
    const balance = calculateAccountBalance(
      account({ id: 'a' }),
      [tx('a', '2026-08-05T00:00:00Z', '-1500'), tx('a', '2026-08-10T00:00:00Z', '2000')],
      checkpoint('a', '2026-07-31', '10000'),
    );

    expect(balance.toString()).toBe('10500');
  });

  it('excludes transactions already reflected in the checkpoint', () => {
    // The bank showed this figure at the end of 31 July, so that day is in it.
    const balance = calculateAccountBalance(
      account({ id: 'a' }),
      [tx('a', '2026-07-31T00:00:00Z', '-999'), tx('a', '2026-08-01T00:00:00Z', '-1')],
      checkpoint('a', '2026-07-31', '10000'),
    );

    expect(balance.toString()).toBe('9999');
  });

  it('ignores transactions from other accounts', () => {
    const balance = calculateAccountBalance(
      account({ id: 'a' }),
      [tx('b', '2026-08-05T00:00:00Z', '-50')],
      checkpoint('a', '2026-07-31', '100'),
    );

    expect(balance.toString()).toBe('100');
  });

  it('falls back to the plain transaction sum with no checkpoint', () => {
    const balance = calculateAccountBalance(account({ id: 'a' }), [tx('a', '2026-07-05T00:00:00Z', '-1500')]);

    expect(balance.toString()).toBe('-1500');
  });

  it('counts a transfer between our own accounts on each account', () => {
    const transfers = [
      tx('sav', '2026-08-15T00:00:00Z', '-13700', 'INTERNAL_TRANSFER'),
      tx('cur', '2026-08-15T00:00:00Z', '13700', 'INTERNAL_TRANSFER'),
    ];

    expect(
      calculateAccountBalance(account({ id: 'sav' }), transfers, checkpoint('sav', '2026-07-31', '20000')).toString(),
    ).toBe('6300');
    expect(
      calculateAccountBalance(account({ id: 'cur' }), transfers, checkpoint('cur', '2026-07-31', '0')).toString(),
    ).toBe('13700');
  });

  it('keeps exact decimals', () => {
    const balance = calculateAccountBalance(
      account({ id: 'a' }),
      [tx('a', '2026-08-01T00:00:00Z', '0.2')],
      checkpoint('a', '2026-07-31', '0.1'),
    );

    expect(balance.toString()).toBe('0.3');
  });

  it('skips a split parent, counting only its children', () => {
    // -908.50 split into -700 and -208.50 after the checkpoint.
    const balance = calculateAccountBalance(
      account({ id: 'a' }),
      [
        tx('a', '2026-08-10T00:00:00Z', '-908.50', 'SPLIT_PARENT'),
        tx('a', '2026-08-10T00:00:00Z', '-700'),
        tx('a', '2026-08-10T00:00:00Z', '-208.50'),
      ],
      checkpoint('a', '2026-07-31', '1000'),
    );

    expect(balance.toString()).toBe('91.5');
  });
});

describe('latestSnapshotByAccount', () => {
  it('keeps the newest snapshot per account', () => {
    const latest = latestSnapshotByAccount([
      checkpoint('t212', '2026-08-01', '100'),
      checkpoint('t212', '2026-08-18', '14610'),
      checkpoint('other', '2026-08-10', '5'),
    ]);

    expect(latest.get('t212')?.balanceCzk?.toString()).toBe('14610');
    expect(latest.size).toBe(2);
  });
});

describe('reconcileCheckpoint', () => {
  const current = account({ id: 'a' });

  it('cannot reconcile the first checkpoint', () => {
    const result = reconcileCheckpoint(current, [], undefined, {
      balance: d('10000'),
      capturedAt: endOfDayUtc(new Date('2026-07-31T00:00:00Z')),
    });

    expect(result.expected).toBeNull();
    expect(result.difference).toBeNull();
    expect(result.matches).toBe(true);
  });

  it('confirms a complete import when the figures agree', () => {
    const result = reconcileCheckpoint(
      current,
      [tx('a', '2026-08-10T00:00:00Z', '-1500'), tx('a', '2026-08-20T00:00:00Z', '500')],
      checkpoint('a', '2026-07-31', '10000'),
      { balance: d('9000'), capturedAt: endOfDayUtc(new Date('2026-08-31T00:00:00Z')) },
    );

    expect(result.expected?.toString()).toBe('9000');
    expect(result.difference?.toString()).toBe('0');
    expect(result.matches).toBe(true);
  });

  it('names the exact amount that is unaccounted for', () => {
    // A whole month was never imported: the bank is 2 000 lower than predicted.
    const result = reconcileCheckpoint(current, [], checkpoint('a', '2026-07-31', '10000'), {
      balance: d('8000'),
      capturedAt: endOfDayUtc(new Date('2026-08-31T00:00:00Z')),
    });

    expect(result.expected?.toString()).toBe('10000');
    expect(result.difference?.toString()).toBe('-2000');
    expect(result.matches).toBe(false);
  });

  it('counts only movements between the two checkpoints', () => {
    const result = reconcileCheckpoint(
      current,
      [
        tx('a', '2026-07-15T00:00:00Z', '-99999'),
        tx('a', '2026-08-10T00:00:00Z', '-1000'),
        tx('a', '2026-09-05T00:00:00Z', '-99999'),
      ],
      checkpoint('a', '2026-07-31', '10000'),
      { balance: d('9000'), capturedAt: endOfDayUtc(new Date('2026-08-31T00:00:00Z')) },
    );

    expect(result.matches).toBe(true);
  });

  it('does not double-count a split parent against its own children', () => {
    const result = reconcileCheckpoint(
      current,
      [
        tx('a', '2026-08-10T00:00:00Z', '-908.50', 'SPLIT_PARENT'),
        tx('a', '2026-08-10T00:00:00Z', '-700'),
        tx('a', '2026-08-10T00:00:00Z', '-208.50'),
      ],
      checkpoint('a', '2026-07-31', '10000'),
      { balance: d('9091.50'), capturedAt: endOfDayUtc(new Date('2026-08-31T00:00:00Z')) },
    );

    expect(result.matches).toBe(true);
  });
});

describe('calculateNetWorth', () => {
  const accounts = [
    account({ id: 'cur', name: 'Běžný', type: 'CHECKING' }),
    account({ id: 'sav', name: 'Spořicí', type: 'SAVINGS' }),
    account({ id: 't212', name: 'Trading 212', type: 'INVESTMENT' }),
    account({ id: 'cc', name: 'Kreditka', type: 'CREDIT' }),
  ];

  const snapshots = [
    checkpoint('cur', '2026-07-31', '10000'),
    checkpoint('sav', '2026-07-31', '50000'),
    { accountId: 't212', capturedAt: new Date('2026-08-18T08:00:00Z'), balanceCzk: d('14610.07') },
    checkpoint('cc', '2026-07-31', '0'),
  ];

  it('combines cash, investments and debt', () => {
    const result = calculateNetWorth(
      accounts,
      [tx('cur', '2026-08-10T00:00:00Z', '-2000'), tx('cc', '2026-08-12T00:00:00Z', '-3000')],
      snapshots,
    );

    expect(result.cashValue.toString()).toBe('58000');
    expect(result.investmentValue.toString()).toBe('14610.07');
    // A credit balance of -3000 is 3000 of debt.
    expect(result.liabilityValue.toString()).toBe('3000');
    expect(result.totalWorth.toString()).toBe('69610.07');
  });

  it('does not count a positive credit balance as wealth or debt', () => {
    const result = calculateNetWorth(
      [account({ id: 'cc', type: 'CREDIT' })],
      [tx('cc', '2026-08-12T00:00:00Z', '500')],
      [checkpoint('cc', '2026-07-31', '0')],
    );

    expect(result.liabilityValue.toString()).toBe('0');
    expect(result.totalWorth.toString()).toBe('0');
  });

  it('ignores a positive credit checkpoint because it is availability, not wealth', () => {
    const result = calculateNetWorth(
      [account({ id: 'cc', type: 'CREDIT' })],
      [tx('cc', '2026-08-12T00:00:00Z', '-3492.5')],
      [checkpoint('cc', '2026-08-01', '46507.5')],
    );

    expect(result.liabilityValue.toString()).toBe('3492.5');
    expect(result.totalWorth.toString()).toBe('-3492.5');
  });

  it('keeps net worth unchanged when cash repays matching credit debt', () => {
    const result = calculateNetWorth(
      [account({ id: 'cur', type: 'CHECKING' }), account({ id: 'cc', type: 'CREDIT' })],
      [
        tx('cur', '2026-08-10T00:00:00Z', '-5000', 'INTERNAL_TRANSFER'),
        tx('cc', '2026-08-10T00:00:00Z', '5000', 'INTERNAL_TRANSFER'),
      ],
      [checkpoint('cur', '2026-07-31', '10000'), checkpoint('cc', '2026-07-31', '-5000')],
    );

    expect(result.cashValue.toString()).toBe('5000');
    expect(result.liabilityValue.toString()).toBe('0');
    expect(result.totalWorth.toString()).toBe('5000');
  });

  it('values an investment account from its snapshot, not its transactions', () => {
    const result = calculateNetWorth(accounts, [tx('t212', '2026-08-19T00:00:00Z', '-999999')], snapshots);

    expect(result.investmentValue.toString()).toBe('14610.07');
  });

  it('reports an investment account with no snapshot as unknown rather than a confident zero', () => {
    const result = calculateNetWorth([account({ id: 't212', type: 'INVESTMENT' })], [], []);

    expect(result.accounts[0]?.source).toBe('UNKNOWN');
    expect(result.accounts[0]?.balance.toString()).toBe('0');
  });

  it('flags a cash account with no checkpoint as an incomplete lower bound', () => {
    const result = calculateNetWorth([account({ id: 'cur' })], [tx('cur', '2026-07-05T00:00:00Z', '-100')], []);

    expect(result.accounts[0]?.incompleteHistory).toBe(true);
    expect(result.accounts[0]?.source).toBe('TRANSACTIONS');
  });

  it('does not flag a cash account once it has a checkpoint', () => {
    const result = calculateNetWorth([account({ id: 'cur' })], [], [checkpoint('cur', '2026-07-31', '10000')]);

    expect(result.accounts[0]?.incompleteHistory).toBe(false);
    expect(result.accounts[0]?.source).toBe('CHECKPOINT');
  });

  it('skips accounts excluded from net worth', () => {
    const excluded = [account({ id: 'x', includeInNetWorth: false })];

    expect(calculateNetWorth(excluded, [], [checkpoint('x', '2026-07-31', '999')]).totalWorth.toString()).toBe('0');
  });

  it('excludes movements after an as-of date', () => {
    const result = calculateNetWorth(
      [account({ id: 'cur', type: 'CHECKING' })],
      [tx('cur', '2026-08-23T00:00:00Z', '100'), tx('cur', '2026-08-24T00:00:00Z', '999')].filter(
        (transaction) => transaction.date.getTime() <= new Date('2026-08-23T23:59:59.999Z').getTime(),
      ),
      [checkpoint('cur', '2026-08-22', '1000')],
    );

    expect(result.cashValue.toString()).toBe('1100');
  });

  it('handles an empty household', () => {
    expect(calculateNetWorth([], [], []).totalWorth.toString()).toBe('0');
  });
});
