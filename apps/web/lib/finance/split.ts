import { Prisma } from '@/lib/generated/prisma/client';

/**
 * Splitting one transaction into several. Pure: amounts in, a verdict out. No
 * Prisma, no id generation — the caller owns persistence.
 *
 * The invariant that matters: the parts must sum to exactly the parent amount.
 * A remainder left over would mean money the ledger cannot account for; letting
 * one part silently absorb it would hide a typo instead of catching it.
 */

const MIN_LINES = 2;

export interface SplitLine {
  amount: Prisma.Decimal;
}

export class SplitInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SplitInputError';
  }
}

/** parentAmount minus the sum of the lines. Zero means the split is complete. */
export function remainingToSplit(parentAmount: Prisma.Decimal, lines: readonly SplitLine[]): Prisma.Decimal {
  return lines.reduce((remaining, line) => remaining.minus(line.amount), parentAmount);
}

export type SplitValidation = { ok: true } | { ok: false; error: string };

/**
 * Checks a proposed split before it is written.
 *
 * Every line must carry the parent's sign: a -1000 expense split into a -600
 * and a +400 would turn part of a cost into income out of nowhere. Zero-amount
 * lines are rejected too — they carry no money, so they cannot be a real part
 * of the split.
 */
export function validateSplit(parentAmount: Prisma.Decimal, lines: readonly SplitLine[]): SplitValidation {
  if (parentAmount.isZero()) {
    return { ok: false, error: 'Nulovou transakci nelze rozdělit' };
  }

  if (lines.length < MIN_LINES) {
    return { ok: false, error: `Rozdělení potřebuje alespoň ${MIN_LINES} části` };
  }

  const parentIsNegative = parentAmount.isNegative();

  for (const line of lines) {
    if (line.amount.isZero()) {
      return { ok: false, error: 'Žádná část nesmí být nulová' };
    }

    if (line.amount.isNegative() !== parentIsNegative) {
      return { ok: false, error: 'Všechny části musí mít stejné znaménko jako původní transakce' };
    }
  }

  const remaining = remainingToSplit(parentAmount, lines);

  if (!remaining.isZero()) {
    return { ok: false, error: `Zbývá rozdělit ${remaining.toFixed(2)}` };
  }

  return { ok: true };
}
