/**
 * Integration test for the credit-card payoff auto-detection. Requires a
 * running database (`npm run db:up`) and is excluded from the default unit
 * -test run: `npm run test:integration`.
 *
 * Auth is mocked (real login has no request context outside the Next.js
 * server), everything else — Prisma, the matching query, the checkpoint
 * write — runs against the real test database.
 */
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';

vi.mock('@/lib/auth', () => ({
  getActiveUser: vi.fn().mockResolvedValue({ id: 'test-user', email: 'test@example.com', role: 'OWNER' }),
}));

// revalidatePath needs a real Next.js request's static-generation store, which
// doesn't exist outside a running server — only relevant to caching, not to
// what this test verifies.
vi.mock('next/cache', () => ({
  revalidatePath: vi.fn(),
}));

import { prisma } from '@/lib/db/prisma';

import { confirmCreditPayoffFromChecking, findCreditRepaymentCandidates } from './actions';

const VARIABLE_SYMBOL = '1010774842';
const CARD_LAST4 = '5266';

let checkingAccountId = '';
let creditAccountId = '';

async function cleanUp(): Promise<void> {
  const accounts = await prisma.account.findMany({
    where: { OR: [{ id: checkingAccountId || undefined }, { id: creditAccountId || undefined }] },
    select: { id: true },
  });
  const accountIds = accounts.map((a) => a.id);

  if (accountIds.length === 0) return;

  await prisma.accountSnapshot.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.transaction.deleteMany({ where: { accountId: { in: accountIds } } });
  await prisma.account.deleteMany({ where: { id: { in: accountIds } } });
}

beforeAll(async () => {
  const checking = await prisma.account.create({
    data: { name: 'Běžný účet test', type: 'CHECKING', provider: 'MONETA', currency: 'CZK', externalId: '204370628/0600' },
  });
  checkingAccountId = checking.id;

  const credit = await prisma.account.create({
    data: { name: 'MoneyCard test', type: 'CREDIT', provider: 'MONETA', currency: 'CZK', externalId: VARIABLE_SYMBOL, cardLast4: CARD_LAST4 },
  });
  creditAccountId = credit.id;
});

afterAll(async () => {
  await cleanUp();
  await prisma.$disconnect();
});

describe('credit card payoff auto-detection (Variabilní Symbol match)', () => {
  it('does not surface a candidate when the credit account has no checkpoint yet', async () => {
    await prisma.transaction.create({
      data: {
        accountId: checkingAccountId,
        date: new Date('2026-09-01T00:00:00.000Z'),
        amount: '-13383.86',
        amountCzk: '-13383.86',
        currency: 'CZK',
        merchant: 'MMB - TECH. ÚČTY',
        kind: 'NORMAL',
        idempotencyKey: 'test-payoff-no-anchor',
        rawData: { 'Variabilní Symbol': VARIABLE_SYMBOL, 'Zpráva pro příjemce': '4243 36** **** 5266' },
      },
    });

    const candidates = await findCreditRepaymentCandidates();
    expect(candidates.some((c) => c.matchedBy === 'VARIABLE_SYMBOL')).toBe(false);

    await prisma.transaction.deleteMany({ where: { accountId: checkingAccountId } });
  });

  it('surfaces and confirms a payoff once the credit account has a baseline checkpoint', async () => {
    // Simulates a prior August card statement (or "Splatit dluh"/"Potvrdit nulový start").
    await prisma.accountSnapshot.create({
      data: { accountId: creditAccountId, capturedAt: new Date('2026-08-31T23:59:59.999Z'), currency: 'CZK', balance: '-12586.86', balanceCzk: '-12586.86', source: 'MANUAL' },
    });

    const payment = await prisma.transaction.create({
      data: {
        accountId: checkingAccountId,
        date: new Date('2026-09-01T00:00:00.000Z'),
        amount: '-13383.86',
        amountCzk: '-13383.86',
        currency: 'CZK',
        merchant: 'MMB - TECH. ÚČTY',
        kind: 'NORMAL',
        idempotencyKey: 'test-payoff-with-anchor',
        rawData: { 'Variabilní Symbol': VARIABLE_SYMBOL, 'Zpráva pro příjemce': '4243 36** **** 5266' },
      },
    });

    const candidates = await findCreditRepaymentCandidates();
    const candidate = candidates.find((c) => c.sourceTransactionId === payment.id);

    expect(candidate).toMatchObject({
      matchedBy: 'VARIABLE_SYMBOL',
      creditTransactionId: null,
      creditAccountId,
      amount: '13383.86',
      sourceAccountName: 'Běžný účet test',
    });

    const result = await confirmCreditPayoffFromChecking(payment.id, creditAccountId);
    expect(result.ok).toBe(true);

    const updated = await prisma.transaction.findUniqueOrThrow({ where: { id: payment.id } });
    expect(updated.kind).toBe('INTERNAL_TRANSFER');
    expect(updated.transferId).not.toBeNull();

    const newSnapshot = await prisma.accountSnapshot.findFirstOrThrow({
      where: { accountId: creditAccountId },
      orderBy: { capturedAt: 'desc' },
    });
    // -12586.86 + 13383.86 = 797.00 — the payment slightly overpaid the debt.
    expect(newSnapshot.balance.toFixed(2)).toBe('797.00');
  });

  it('refuses to confirm a payoff whose Variabilní Symbol does not match', async () => {
    const mismatched = await prisma.transaction.create({
      data: {
        accountId: checkingAccountId,
        date: new Date('2026-09-02T00:00:00.000Z'),
        amount: '-500.00',
        amountCzk: '-500.00',
        currency: 'CZK',
        merchant: 'Someone else',
        kind: 'NORMAL',
        idempotencyKey: 'test-payoff-mismatch',
        rawData: { 'Variabilní Symbol': '999999999' },
      },
    });

    const result = await confirmCreditPayoffFromChecking(mismatched.id, creditAccountId);
    expect(result.ok).toBe(false);

    const unchanged = await prisma.transaction.findUniqueOrThrow({ where: { id: mismatched.id } });
    expect(unchanged.kind).toBe('NORMAL');
    expect(unchanged.transferId).toBeNull();
  });
});
