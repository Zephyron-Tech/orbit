import { describe, expect, it, vi } from 'vitest';

const { transactionMock } = vi.hoisted(() => ({ transactionMock: vi.fn() }));

vi.mock('@/lib/db/prisma', () => ({
  prisma: { $transaction: transactionMock },
}));

import { Prisma } from '@/lib/generated/prisma/client';

import { reorderRows } from './reorder';

interface Row {
  id: string;
}

function fakeTx(rows: Row[]): { findMany: () => Promise<Row[]>; update: ReturnType<typeof vi.fn> } {
  return { findMany: () => Promise.resolve(rows), update: vi.fn().mockResolvedValue(undefined) };
}

describe('reorderRows', () => {
  it('moves the target and writes sequential positions for every row', async () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];
    const writes: { id: string; position: number }[] = [];

    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(fakeTx(rows));
    });

    const result = await reorderRows(
      'a',
      1,
      async () => rows,
      async (_tx, id, position) => {
        writes.push({ id, position });
      },
    );

    expect(result).toEqual({ ok: true });
    // a moves past b: b is now first, a second, c unchanged third.
    expect(writes).toEqual([{ id: 'b', position: 0 }, { id: 'a', position: 1 }, { id: 'c', position: 2 }]);
  });

  it('reports NOT_FOUND without touching the database when the target id is missing', async () => {
    const rows: Row[] = [{ id: 'a' }, { id: 'b' }];
    const write = vi.fn();

    transactionMock.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
      await fn(fakeTx(rows));
    });

    const result = await reorderRows('missing', 1, async () => rows, write);

    expect(result).toEqual({ ok: false, error: 'NOT_FOUND' });
    expect(write).not.toHaveBeenCalled();
  });

  it('translates a Postgres serialization failure (P2034) into a CONFLICT result instead of throwing', async () => {
    transactionMock.mockImplementation(async () => {
      throw new Prisma.PrismaClientKnownRequestError('Transaction failed due to a write conflict or a deadlock.', {
        code: 'P2034',
        clientVersion: 'test',
      });
    });

    const result = await reorderRows('a', 1, async () => [{ id: 'a' }, { id: 'b' }], vi.fn());

    expect(result).toEqual({ ok: false, error: 'CONFLICT' });
  });

  it('re-throws any other error unchanged — only P2034 means "retry me"', async () => {
    transactionMock.mockImplementation(async () => {
      throw new Error('something unrelated broke');
    });

    await expect(reorderRows('a', 1, async () => [{ id: 'a' }], vi.fn())).rejects.toThrow('something unrelated broke');
  });
});
