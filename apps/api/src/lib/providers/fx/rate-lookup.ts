import { z } from 'zod';

import { Prisma } from '@orbit-api/lib/generated/prisma/client';

/**
 * Historical daily FX rates, so a foreign-currency transaction gets a real
 * `amountCzk` instead of the `null` that silently drops it from every
 * cash-flow aggregate. Frankfurter (frankfurter.dev) is a free, keyless,
 * ECB-reference-rate API — no account, no rate limit that matters at this
 * volume. It answers weekend/holiday dates with the last business day's
 * rate and reports which date it actually used.
 */

export class FxRateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FxRateError';
  }
}

const rateResponseSchema = z.object({
  amount: z.number(),
  base: z.string(),
  date: z.string(),
  rates: z.record(z.string(), z.number()),
});

/**
 * JSON numbers are IEEE-754 doubles, so a value is turned into a string
 * exactly once, here, before it becomes a `Decimal` — same discipline as
 * `lib/providers/trading212/schemas.ts`'s `toDecimalString`. `fxRate` is
 * `Decimal(18, 8)`.
 */
function toRateString(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    throw new FxRateError(`Frankfurter returned a non-finite or non-positive rate: ${String(value)}`);
  }

  return value.toFixed(8);
}

export interface LookupFxRateOptions {
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

/**
 * Looks up the historical `from` -> `to` reference rate for `date` (UTC
 * calendar day, matching how transaction dates are stored). Throws
 * `FxRateError` rather than guessing — a wrong silent rate is worse than a
 * visibly failed conversion, same principle as the CSV parser refusing a row
 * it can't deduplicate safely.
 */
export async function lookupFxRate(
  date: Date,
  from: string,
  to: 'CZK',
  options: LookupFxRateOptions = {},
): Promise<Prisma.Decimal> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const dateKey = date.toISOString().slice(0, 10);

  if (from === to) {
    return new Prisma.Decimal(1);
  }

  const url = `https://api.frankfurter.dev/v1/${dateKey}?base=${encodeURIComponent(from)}&symbols=${to}`;

  let response: Response;

  try {
    response = await fetchImpl(url, { cache: 'no-store' });
  } catch (error: unknown) {
    throw new FxRateError(`Could not reach the FX rate API: ${error instanceof Error ? error.message : String(error)}`);
  }

  if (!response.ok) {
    throw new FxRateError(`FX rate API returned ${response.status} for ${from}->${to} on ${dateKey}`);
  }

  const payload: unknown = await response.json();
  const parsed = rateResponseSchema.safeParse(payload);

  if (!parsed.success) {
    throw new FxRateError(`Unexpected FX rate API response shape for ${from}->${to} on ${dateKey}`);
  }

  const rate = parsed.data.rates[to];

  if (rate === undefined) {
    throw new FxRateError(`FX rate API response for ${from}->${to} on ${dateKey} has no ${to} rate`);
  }

  return new Prisma.Decimal(toRateString(rate));
}

/**
 * Memoizes `lookupFxRate` by (date, currency) for the lifetime of one import
 * run — a statement with twenty EUR rows on the same day should trigger one
 * HTTP call, not twenty.
 */
export function createFxRateResolver(options: LookupFxRateOptions = {}) {
  const cache = new Map<string, Promise<Prisma.Decimal>>();

  return function resolve(date: Date, from: string, to: 'CZK'): Promise<Prisma.Decimal> {
    const key = `${date.toISOString().slice(0, 10)}|${from}|${to}`;
    const cached = cache.get(key);

    if (cached) {
      return cached;
    }

    const pending = lookupFxRate(date, from, to, options);
    cache.set(key, pending);

    return pending;
  };
}
