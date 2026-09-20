/**
 * Integration test for dismissUnmatchedTransfer. Requires a running
 * database (`npm run db:up`) and is excluded from the default unit-test
 * run: `npm run test:integration`.
 *
 * Auth is mocked (real login has no request context outside the Next.js
 * server), everything else runs against the real test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getActiveUser: vi.fn().mockResolvedValue({ id: 'test-user', email: 'test@example.com', role: 'OWNER' }),
}));

vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';

import { dismissUnmatchedTransfer } from './actions';

let accountId = '';

async function makeTransaction(overrides: { kind: 'INTERNAL_TRANSFER' | 'PENDING_TRANSFER' | 'NORMAL'; transferId?: string | null; transferDismissedAt?: Date | null; idempotencyKey: string }) {
  return prisma.transaction.create({
    data: {
      accountId,
      date: new Date('2026-08-20T00:00:00.000Z'),
      amount: '-25000.00',
      amountCzk: '-25000.00',
      currency: 'CZK',
      merchant: 'VANDLÍČEK JAN',
      kind: overrides.kind,
      transferId: overrides.transferId ?? null,
      transferDismissedAt: overrides.transferDismissedAt ?? null,
      idempotencyKey: overrides.idempotencyKey,
    },
  });
}

beforeAll(async () => {
  const account = await prisma.account.create({
    data: { name: 'Dismiss transfer test', type: 'CHECKING', provider: 'MONETA', currency: 'CZK' },
  });
  accountId = account.id;
});

afterAll(async () => {
  await prisma.transaction.deleteMany({ where: { accountId } });
  await prisma.account.delete({ where: { id: accountId } });
  await prisma.$disconnect();
});

describe('dismissUnmatchedTransfer', () => {
  it('dismisses a genuinely unmatched INTERNAL_TRANSFER without changing kind or transferId', async () => {
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', idempotencyKey: 'dismiss-test-1' });

    const result = await dismissUnmatchedTransfer(tx.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(updated.kind).toBe('INTERNAL_TRANSFER');
    expect(updated.transferId).toBeNull();
    expect(updated.transferDismissedAt).not.toBeNull();
  });

  it('dismisses a genuinely unmatched PENDING_TRANSFER too', async () => {
    const tx = await makeTransaction({ kind: 'PENDING_TRANSFER', idempotencyKey: 'dismiss-test-2' });

    const result = await dismissUnmatchedTransfer(tx.id);
    expect(result.ok).toBe(true);

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(updated.transferDismissedAt).not.toBeNull();
  });

  it('refuses a transaction that is already matched (has a transferId)', async () => {
    const transfer = await prisma.transfer.create({ data: {} });
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', transferId: transfer.id, idempotencyKey: 'dismiss-test-3' });

    const result = await dismissUnmatchedTransfer(tx.id);
    expect(result.ok).toBe(false);

    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: tx.id } });
    expect(unchanged.transferDismissedAt).toBeNull();
  });

  it('refuses a NORMAL transaction — nothing to dismiss', async () => {
    const tx = await makeTransaction({ kind: 'NORMAL', idempotencyKey: 'dismiss-test-4' });

    const result = await dismissUnmatchedTransfer(tx.id);
    expect(result.ok).toBe(false);
  });

  it('refuses a transaction already dismissed', async () => {
    const tx = await makeTransaction({ kind: 'INTERNAL_TRANSFER', transferDismissedAt: new Date(), idempotencyKey: 'dismiss-test-5' });

    const result = await dismissUnmatchedTransfer(tx.id);
    expect(result.ok).toBe(false);
  });
});
