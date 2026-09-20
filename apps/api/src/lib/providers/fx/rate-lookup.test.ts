import { describe, expect, it, vi } from 'vitest';

import { createFxRateResolver, FxRateError, lookupFxRate } from './rate-lookup';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('lookupFxRate', () => {
  it('parses the rate for the requested currency', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'EUR', date: '2026-08-21', rates: { CZK: 24.116 } }));

    const rate = await lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK', { fetchImpl });

    expect(rate.toFixed(4)).toBe('24.1160');
  });

  it('requests the transaction date and currency pair', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'USD', date: '2026-08-21', rates: { CZK: 22.5 } }));

    await lookupFxRate(new Date('2026-08-21T15:32:00.000Z'), 'USD', 'CZK', { fetchImpl });

    const url = fetchImpl.mock.calls[0]?.[0] as string;

    expect(url).toContain('/v1/2026-08-21');
    expect(url).toContain('base=USD');
    expect(url).toContain('symbols=CZK');
  });

  it('is 1 without a network call when the currencies match', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}));

    const rate = await lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'CZK', 'CZK', { fetchImpl });

    expect(rate.toFixed(0)).toBe('1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('throws FxRateError on a non-OK response, not a guessed rate', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'not found' }, 404));

    await expect(lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK', { fetchImpl })).rejects.toThrow(FxRateError);
  });

  it('throws FxRateError when the response has no rate for the target currency', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'EUR', date: '2026-08-21', rates: {} }));

    await expect(lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK', { fetchImpl })).rejects.toThrow(FxRateError);
  });

  it('throws FxRateError when the response shape is unexpected', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ nonsense: true }));

    await expect(lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK', { fetchImpl })).rejects.toThrow(FxRateError);
  });

  it('throws FxRateError when the network call itself fails', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      throw new Error('network down');
    });

    await expect(lookupFxRate(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK', { fetchImpl })).rejects.toThrow(FxRateError);
  });
});

describe('createFxRateResolver', () => {
  it('caches by date and currency, so repeated lookups make one HTTP call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'EUR', date: '2026-08-21', rates: { CZK: 24.116 } }));
    const resolve = createFxRateResolver({ fetchImpl });

    const [a, b, c] = await Promise.all([
      resolve(new Date('2026-08-21T09:00:00.000Z'), 'EUR', 'CZK'),
      resolve(new Date('2026-08-21T15:00:00.000Z'), 'EUR', 'CZK'),
      resolve(new Date('2026-08-21T20:00:00.000Z'), 'EUR', 'CZK'),
    ]);

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(a.toFixed(4)).toBe('24.1160');
    expect(b.toFixed(4)).toBe('24.1160');
    expect(c.toFixed(4)).toBe('24.1160');
  });

  it('makes a separate call for a different date', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'EUR', date: '2026-08-21', rates: { CZK: 24.116 } }));
    const resolve = createFxRateResolver({ fetchImpl });

    await resolve(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK');
    await resolve(new Date('2026-08-22T00:00:00.000Z'), 'EUR', 'CZK');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('makes a separate call for a different currency', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ amount: 1, base: 'EUR', date: '2026-08-21', rates: { CZK: 24.116 } }));
    const resolve = createFxRateResolver({ fetchImpl });

    await resolve(new Date('2026-08-21T00:00:00.000Z'), 'EUR', 'CZK');
    await resolve(new Date('2026-08-21T00:00:00.000Z'), 'USD', 'CZK');

    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
