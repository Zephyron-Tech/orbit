import { Prisma } from '@/lib/generated/prisma/client';

/**
 * My share of a shared amount. Pure, one calculation, used everywhere a
 * `myShareRatio` needs to become a number: settlement and burn rate must
 * agree on what "my share" means, so there is exactly one place that computes
 * it rather than two copies drifting apart.
 *
 * Convention (see CLAUDE.md): `ratio` is *my* share, not the payer's —
 * 0.5 = even split, 0.6 = I owe 60%, 1.0 = fully mine.
 */

export const DEFAULT_SHARE_RATIO = new Prisma.Decimal('0.5');

export class ShareInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ShareInputError';
  }
}

export function assertValidRatio(ratio: Prisma.Decimal, context: string): void {
  if (ratio.lessThan(0) || ratio.greaterThan(1)) {
    throw new ShareInputError(`${context} has a share ratio outside 0–1: ${ratio.toString()}`);
  }
}

/** `total` split by `ratio`. `ratio` defaults to an even split when null. */
export function computeMyShare(total: Prisma.Decimal, ratio: Prisma.Decimal | null, context: string): Prisma.Decimal {
  const resolvedRatio = ratio ?? DEFAULT_SHARE_RATIO;

  assertValidRatio(resolvedRatio, context);

  return total.times(resolvedRatio);
}
