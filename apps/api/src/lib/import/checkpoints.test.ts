import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@orbit-api/lib/db/prisma', () => ({
  prisma: {
    account: { findUniqueOrThrow: vi.fn() },
    accountSnapshot: { findFirst: vi.fn(), upsert: vi.fn() },
    transaction: { findMany: vi.fn() },
  },
}));

vi.mock('@orbit-api/lib/providers/fx/rate-lookup', () => ({
  lookupFxRate: vi.fn(),
}));

import { Prisma } from '@orbit-api/lib/generated/prisma/client';
import { prisma } from '@orbit-api/lib/db/prisma';
import { lookupFxRate } from '@orbit-api/lib/providers/fx/rate-lookup';

import { recordBalanceCheckpoint } from './checkpoints';

describe('recordBalanceCheckpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(prisma.accountSnapshot.findFirst).mockResolvedValue(null);
    vi.mocked(prisma.transaction.findMany).mockResolvedValue([]);
    vi.mocked(prisma.accountSnapshot.upsert).mockResolvedValue({} as never);
  });

  it('stores the raw balance as balanceCzk directly for a CZK account, no FX lookup', async () => {
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({
      id: 'acc1',
      name: 'Hlavní účet',
      type: 'CHECKING',
      currency: 'CZK',
    } as never);

    await recordBalanceCheckpoint({ accountId: 'acc1', day: '2026-08-31', balance: '1000.00' });

    expect(lookupFxRate).not.toHaveBeenCalled();
    const call = vi.mocked(prisma.accountSnapshot.upsert).mock.calls[0]?.[0];
    expect(call?.create.balanceCzk?.toString()).toBe('1000');
  });

  it('converts a foreign-currency balance to CZK via the FX lookup instead of storing null', async () => {
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({
      id: 'acc-eur',
      name: 'Běžný účet EUR',
      type: 'CHECKING',
      currency: 'EUR',
    } as never);
    vi.mocked(lookupFxRate).mockResolvedValue(new Prisma.Decimal('25.00000000'));

    await recordBalanceCheckpoint({ accountId: 'acc-eur', day: '2026-08-31', balance: '100.00' });

    expect(lookupFxRate).toHaveBeenCalledWith(expect.any(Date), 'EUR', 'CZK');
    const call = vi.mocked(prisma.accountSnapshot.upsert).mock.calls[0]?.[0];
    expect(call?.create.balanceCzk?.toString()).toBe('2500');
  });

  it('degrades to null (never throws) when the FX lookup fails, same as before this existed', async () => {
    vi.mocked(prisma.account.findUniqueOrThrow).mockResolvedValue({
      id: 'acc-eur',
      name: 'Běžný účet EUR',
      type: 'CHECKING',
      currency: 'EUR',
    } as never);
    vi.mocked(lookupFxRate).mockRejectedValue(new Error('FX API unreachable'));

    await expect(recordBalanceCheckpoint({ accountId: 'acc-eur', day: '2026-08-31', balance: '100.00' })).resolves.toBeDefined();

    const call = vi.mocked(prisma.accountSnapshot.upsert).mock.calls[0]?.[0];
    expect(call?.create.balanceCzk).toBeNull();
  });
});
