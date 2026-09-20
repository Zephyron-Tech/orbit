import { describe, expect, it } from 'vitest';

import { Prisma } from '@/lib/generated/prisma/client';

import { computeMyShare, DEFAULT_SHARE_RATIO, ShareInputError } from './share';

const d = (value: string): Prisma.Decimal => new Prisma.Decimal(value);

describe('computeMyShare', () => {
  it('splits evenly by default', () => {
    expect(computeMyShare(d('1000'), null, 'test').toString()).toBe('500');
    expect(DEFAULT_SHARE_RATIO.toString()).toBe('0.5');
  });

  it('respects an explicit ratio', () => {
    expect(computeMyShare(d('1000'), d('0.6'), 'test').toString()).toBe('600');
  });

  it('handles the extremes: fully mine and none of it', () => {
    expect(computeMyShare(d('500'), d('1'), 'test').toString()).toBe('500');
    expect(computeMyShare(d('500'), d('0'), 'test').toString()).toBe('0');
  });

  it('keeps exact decimals', () => {
    expect(computeMyShare(d('908.50'), d('0.5'), 'test').toString()).toBe('454.25');
  });

  it('rejects a ratio outside 0–1, naming the context', () => {
    expect(() => computeMyShare(d('1000'), d('1.5'), 'Transaction abc')).toThrow(
      'Transaction abc has a share ratio outside 0–1: 1.5',
    );
    expect(() => computeMyShare(d('1000'), d('-0.1'), 'test')).toThrow(ShareInputError);
  });
});
