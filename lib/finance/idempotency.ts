import { createHash } from 'node:crypto';

import type { Provider } from '@/lib/generated/prisma/enums';

/**
 * Inputs that uniquely identify a transaction across repeated deliveries of the
 * same source event (a re-sent bank e-mail, a replayed webhook, a re-run T212 sync).
 */
export interface IdempotencyInput {
  provider: Provider;
  /**
   * The source's own transaction reference, when the export supplies one.
   * Moneta's "Bankovní reference" is unique per transaction, which is the only
   * way to tell two genuinely identical same-day purchases apart. When it is
   * present nothing else is hashed, so the key survives reformatting of the
   * amount, the merchant string or the date.
   */
  externalId?: string | null;
  /**
   * The Orbit account the transaction belongs to. Part of the hash so the same
   * purchase booked on two different accounts does not collide.
   */
  accountId: string;
  /** Booking date. Only the calendar day (UTC) is significant. */
  date: Date;
  /** Signed amount in the transaction currency: negative for expenses. */
  amount: string | number;
  /** ISO 4217 code of `amount`. */
  currency: string;
  /** Raw merchant string from the source, if any. */
  merchant: string | null | undefined;
}

const DAY_FORMAT = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Separator between hashed parts. Every part is restricted to characters that
 * exclude this one, so two different inputs can never join into the same string.
 */
const SEPARATOR = '|';

/**
 * Normalizes a merchant string so that cosmetic differences between two
 * deliveries of the same e-mail do not produce two different keys.
 *
 * Strips diacritics, uppercases, collapses whitespace, and drops everything
 * that is not a letter, digit or space.
 */
export function normalizeMerchant(merchant: string | null | undefined): string {
  if (!merchant) {
    return '';
  }

  return merchant
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Converts a decimal amount to signed minor units as a string, so that
 * "-1234.5", -1234.5 and "-1234.50" all hash identically.
 *
 * Uses string arithmetic rather than `Number` to avoid binary floating-point
 * drift on amounts that cannot be represented exactly.
 */
export function toMinorUnits(amount: string | number): string {
  const raw = typeof amount === 'number' ? amount.toFixed(4) : amount.trim();
  const match = /^(-)?(\d+)(?:\.(\d+))?$/.exec(raw);

  if (!match) {
    throw new Error(`Invalid amount for idempotency key: ${String(amount)}`);
  }

  const [, sign, whole, fraction = ''] = match;

  // `amount.toFixed(4)` always pads the fraction to 4 digits, so only the
  // digits past the 2nd (cent) position being non-zero means real precision
  // would be lost — trailing zeros from padding are harmless.
  if (/[1-9]/.test(fraction.slice(2))) {
    throw new Error(`Amount has more than 2 decimal places, cannot hash into cent-precision idempotency key: ${String(amount)}`);
  }

  const minor = `${fraction}00`.slice(0, 2);
  const digits = `${whole}${minor}`.replace(/^0+(?=\d)/, '');

  // Normalize negative zero so that -0.00 and 0.00 produce the same key.
  return digits === '0' ? '0' : `${sign ?? ''}${digits}`;
}

/** Formats a date as a UTC calendar day, dropping the time component entirely. */
export function toBookingDay(date: Date): string {
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid date for idempotency key');
  }

  const day = date.toISOString().slice(0, 10);

  if (!DAY_FORMAT.test(day)) {
    throw new Error(`Invalid booking day for idempotency key: ${day}`);
  }

  return day;
}

/** Which inputs a key was derived from. Reported back after an import. */
export type DedupStrategy = 'EXTERNAL_ID' | 'ATTRIBUTES';

export function dedupStrategyFor(input: IdempotencyInput): DedupStrategy {
  return input.externalId?.trim() ? 'EXTERNAL_ID' : 'ATTRIBUTES';
}

/**
 * Builds the unique key used to deduplicate a transaction.
 *
 * With a source reference the key is exact. Without one it falls back to the
 * normalized attributes, which cannot distinguish two identical purchases made
 * on the same day at the same merchant — real transactions that a CSV export
 * does contain. Prefer a source that supplies a reference.
 *
 * CHANGING THIS FUNCTION IS A BREAKING CHANGE: every existing key becomes
 * unreachable and duplicates will be created. Any change requires a backfill
 * migration that recomputes the keys of all existing rows.
 */
export function buildIdempotencyKey(input: IdempotencyInput): string {
  const externalId = input.externalId?.trim();

  const parts = externalId
    ? [input.provider, input.accountId, 'ref', externalId]
    : [
        input.provider,
        input.accountId,
        'attr',
        toBookingDay(input.date),
        toMinorUnits(input.amount),
        input.currency.trim().toUpperCase(),
        normalizeMerchant(input.merchant),
      ];

  return createHash('sha256').update(parts.join(SEPARATOR)).digest('hex');
}

/**
 * Dedup key for a `FuelPurchase` row. Not part of `buildIdempotencyKey`
 * above: that function is Account/Provider-shaped (every bank/broker
 * transaction belongs to an Orbit `Account`), and a fuel-card purchase from
 * the tankkarta.cz export isn't a bank movement and has no `accountId`.
 *
 * Unlike the bank ATTRIBUTES fallback, the export supplies a full
 * second-precision timestamp rather than just a calendar day, so that full
 * precision is hashed instead of collapsing to `toBookingDay` — two
 * genuine same-day fill-ups at the same station stay distinguishable.
 */
export function buildFuelPurchaseKey(input: {
  cardLast4: string;
  purchasedAt: Date;
  stationCode: string;
  amountCzk: string | number;
}): string {
  if (Number.isNaN(input.purchasedAt.getTime())) {
    throw new Error('Invalid purchasedAt for fuel purchase idempotency key');
  }

  const parts = [
    'tankkarta',
    input.cardLast4.trim(),
    input.purchasedAt.toISOString(),
    input.stationCode.trim(),
    toMinorUnits(input.amountCzk),
  ];

  return createHash('sha256').update(parts.join(SEPARATOR)).digest('hex');
}
