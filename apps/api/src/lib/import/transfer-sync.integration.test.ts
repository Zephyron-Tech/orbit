/**
 * Integration test for automatic transfer matching. Requires a running
 * database (`npm run db:up`); excluded from the default unit-test run.
 *
 * Uses the real July amounts and dates (13 700 CZK moved from savings to
 * current on 15 July) rather than the anonymized statement fixtures: those
 * two files share one anonymized account number by construction (see
 * `scripts/anonymize-moneta-statement.ts`), which collides with the
 * `@@unique([provider, externalId])` constraint on `Account` — a pre-existing
 * fixture limitation unrelated to transfer matching itself.
 */
import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { prisma } from '@orbit-api/lib/db/prisma';

import { matchPendingTransfers } from './transfer-sync';

let currentAccountId = '';
let savingsAccountId = '';

beforeEach(async () => {
  const current = await prisma.account.create({
    data: { name: 'Transfer test current', type: 'CHECKING', provider: 'MONETA', externalId: 'transfer-test-cur' },
  });
  const savings = await prisma.account.create({
    data: { name: 'Transfer test savings', type: 'SAVINGS', provider: 'MONETA', externalId: 'transfer-test-sav' },
  });

  currentAccountId = current.id;
  savingsAccountId = savings.id;
});

afterEach(async () => {
  await prisma.transaction.deleteMany({ where: { accountId: { in: [currentAccountId, savingsAccountId] } } });
  await prisma.transfer.deleteMany({ where: { legs: { none: {} } } });
  await prisma.account.deleteMany({ where: { id: { in: [currentAccountId, savingsAccountId] } } });
});

/** A minimal CSV-import-shaped row, inserted directly to skip the parser. */
function leg(accountId: string, amount: string, date: string, ref: string) {
  return {
    accountId,
    date: new Date(date),
    amount: new Prisma.Decimal(amount),
    amountCzk: new Prisma.Decimal(amount),
    currency: 'CZK',
    kind: 'INTERNAL_TRANSFER' as const,
    source: 'CSV_IMPORT' as const,
    idempotencyKey: ref,
    externalId: ref,
    merchant: 'VANDLÍČEK JAN',
  };
}

describe('matchPendingTransfers', () => {
  it('matches the real July pair: savings out, current in', async () => {
    await prisma.transaction.createMany({
      data: [
        leg(savingsAccountId, '-13700', '2026-07-15T00:00:00Z', 'test-out-13700'),
        leg(currentAccountId, '13700', '2026-07-15T00:00:00Z', 'test-in-13700'),
      ],
    });

    const result = await matchPendingTransfers();

    expect(result.matched).toBe(1);
    expect(result.ambiguous).toBe(0);

    const legs = await prisma.transaction.findMany({
      where: { accountId: { in: [currentAccountId, savingsAccountId] } },
      select: { transferId: true },
    });

    expect(legs.every((row) => row.transferId !== null)).toBe(true);
    expect(new Set(legs.map((row) => row.transferId)).size).toBe(1);

    const transfers = await prisma.transfer.findMany({ where: { legs: { some: { accountId: savingsAccountId } } } });
    expect(transfers).toHaveLength(1);
  });

  it('is idempotent: running it again touches nothing new', async () => {
    await prisma.transaction.createMany({
      data: [
        leg(savingsAccountId, '-13700', '2026-07-15T00:00:00Z', 'test-out-13700'),
        leg(currentAccountId, '13700', '2026-07-15T00:00:00Z', 'test-in-13700'),
      ],
    });

    await matchPendingTransfers();
    const second = await matchPendingTransfers();

    expect(second.matched).toBe(0);
    await expect(prisma.transfer.count()).resolves.toBe(1);
  });

  it('leaves an unmatched leg flagged but unlinked', async () => {
    await prisma.transaction.create({ data: leg(savingsAccountId, '-500', '2026-07-20T00:00:00Z', 'test-lone') });

    const result = await matchPendingTransfers();

    expect(result.matched).toBe(0);
    expect(result.ambiguous).toBe(0);

    const row = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-lone' } });
    expect(row.transferId).toBeNull();
    expect(row.kind).toBe('INTERNAL_TRANSFER');
  });

  it('promotes a pending broker leg once a bank counterpart is proven', async () => {
    await prisma.transaction.createMany({
      data: [
        leg(savingsAccountId, '-2000', '2026-07-20T00:00:00Z', 'test-bank-to-broker'),
        { ...leg(currentAccountId, '2000', '2026-07-20T00:00:00Z', 'test-broker-deposit'), kind: 'PENDING_TRANSFER' },
      ],
    });

    const result = await matchPendingTransfers();

    expect(result.matched).toBe(1);
    const broker = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-broker-deposit' } });
    expect(broker.kind).toBe('INTERNAL_TRANSFER');
    expect(broker.transferId).not.toBeNull();
  });

  it('does not touch a NORMAL transaction even if the amounts would cancel', async () => {
    await prisma.transaction.createMany({
      data: [
        { ...leg(savingsAccountId, '-1000', '2026-07-10T00:00:00Z', 'test-normal-out'), kind: 'NORMAL' },
        leg(currentAccountId, '1000', '2026-07-10T00:00:00Z', 'test-normal-in'),
      ],
    });

    const result = await matchPendingTransfers();

    expect(result.matched).toBe(0);

    const normalRow = await prisma.transaction.findFirstOrThrow({ where: { externalId: 'test-normal-out' } });
    expect(normalRow.transferId).toBeNull();
  });
});
