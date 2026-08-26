import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/generated/prisma/client';

import { matchTransfers, type TransferCandidate } from './transfer-matching';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

function candidate(id: string, accountId: string, date: string, amount: string): TransferCandidate {
  return { id, accountId, date: new Date(date), amountCzk: d(amount) };
}

describe('matchTransfers', () => {
  it('matches the real July case: savings out, current in', () => {
    const result = matchTransfers([
      candidate('out', 'savings', '2026-07-15T00:00:00Z', '-13700'),
      candidate('in', 'current', '2026-07-15T00:00:00Z', '13700'),
    ]);

    expect(result.pairs).toEqual([['out', 'in']]);
    expect(result.ambiguous).toEqual([]);
  });

  it('matches within the date window, not only same-day', () => {
    const result = matchTransfers([
      candidate('out', 'a', '2026-07-15T00:00:00Z', '-1000'),
      candidate('in', 'b', '2026-07-17T00:00:00Z', '1000'),
    ]);

    expect(result.pairs).toEqual([['out', 'in']]);
  });

  it('does not match outside the date window', () => {
    const result = matchTransfers([
      candidate('out', 'a', '2026-07-15T00:00:00Z', '-1000'),
      candidate('in', 'b', '2026-07-20T00:00:00Z', '1000'),
    ]);

    expect(result.pairs).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it('does not match legs on the same account', () => {
    // Two rows on the same account can never be two legs of one transfer.
    const result = matchTransfers([
      candidate('out', 'a', '2026-07-15T00:00:00Z', '-1000'),
      candidate('in', 'a', '2026-07-15T00:00:00Z', '1000'),
    ]);

    expect(result.pairs).toEqual([]);
  });

  it('refuses to guess when the same amount could pair two ways', () => {
    // Two identical transfers in the same week: which -1000 goes with which
    // +1000 is genuinely unknowable from amount and date alone.
    const result = matchTransfers([
      candidate('out1', 'a', '2026-07-14T00:00:00Z', '-1000'),
      candidate('out2', 'a', '2026-07-16T00:00:00Z', '-1000'),
      candidate('in1', 'b', '2026-07-15T00:00:00Z', '1000'),
      candidate('in2', 'b', '2026-07-17T00:00:00Z', '1000'),
    ]);

    expect(result.pairs).toEqual([]);
    expect(new Set(result.ambiguous)).toEqual(new Set(['out1', 'out2', 'in1', 'in2']));
  });

  it('catches ambiguity introduced from the incoming side too', () => {
    // One outgoing leg has exactly one candidate, but that candidate itself
    // has a second suitor — the reverse check must catch this, not just the
    // forward one.
    const result = matchTransfers([
      candidate('out1', 'a', '2026-07-15T00:00:00Z', '-500'),
      candidate('in', 'b', '2026-07-15T00:00:00Z', '500'),
      candidate('out2', 'c', '2026-07-16T00:00:00Z', '-500'),
    ]);

    expect(result.pairs).toEqual([]);
    expect(new Set(result.ambiguous)).toEqual(new Set(['out1', 'in', 'out2']));
  });

  it('matches an unambiguous pair even when other unrelated pairs exist', () => {
    const result = matchTransfers([
      candidate('out1', 'a', '2026-07-01T00:00:00Z', '-1000'),
      candidate('in1', 'b', '2026-07-01T00:00:00Z', '1000'),
      candidate('out2', 'a', '2026-08-01T00:00:00Z', '-2000'),
      candidate('in2', 'b', '2026-08-01T00:00:00Z', '2000'),
    ]);

    expect(new Set(result.pairs.map((pair) => pair.join(':')))).toEqual(new Set(['out1:in1', 'out2:in2']));
    expect(result.ambiguous).toEqual([]);
  });

  it('never lets one leg appear in more than one pair', () => {
    const result = matchTransfers([
      candidate('out1', 'a', '2026-07-01T00:00:00Z', '-1000'),
      candidate('in1', 'b', '2026-07-01T00:00:00Z', '1000'),
      candidate('out2', 'a', '2026-08-15T00:00:00Z', '-1000'),
      candidate('in2', 'b', '2026-08-15T00:00:00Z', '1000'),
    ]);

    const usedLegs = result.pairs.flat();

    expect(new Set(usedLegs).size).toBe(usedLegs.length);
    expect(result.pairs).toHaveLength(2);
  });

  it('is order-independent', () => {
    const a = matchTransfers([
      candidate('out', 'x', '2026-07-15T00:00:00Z', '-1000'),
      candidate('in', 'y', '2026-07-15T00:00:00Z', '1000'),
    ]);
    const b = matchTransfers([
      candidate('in', 'y', '2026-07-15T00:00:00Z', '1000'),
      candidate('out', 'x', '2026-07-15T00:00:00Z', '-1000'),
    ]);

    expect(a).toEqual(b);
  });

  it('ignores a lone leg with no counterpart at all', () => {
    const result = matchTransfers([candidate('out', 'a', '2026-07-15T00:00:00Z', '-1000')]);

    expect(result.pairs).toEqual([]);
    expect(result.ambiguous).toEqual([]);
  });

  it('handles an empty input', () => {
    expect(matchTransfers([])).toEqual({ pairs: [], ambiguous: [] });
  });

  it('respects a custom window', () => {
    const candidates = [
      candidate('out', 'a', '2026-07-01T00:00:00Z', '-1000'),
      candidate('in', 'b', '2026-07-05T00:00:00Z', '1000'),
    ];

    expect(matchTransfers(candidates, 3).pairs).toEqual([]);
    expect(matchTransfers(candidates, 4).pairs).toEqual([['out', 'in']]);
  });
});
