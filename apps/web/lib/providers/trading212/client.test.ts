import { describe, expect, it, vi } from 'vitest';

import { Trading212Client, Trading212Error } from './client';
import { toDecimalString } from './schemas';

/** Shapes copied from a real live response, with the account id changed. */
const SUMMARY = {
  id: 1,
  currency: 'CZK',
  totalValue: 14613.28,
  cash: { availableToTrade: 0, reservedForOrders: 0, inPies: 0.03 },
  investments: {
    currentValue: 14613.28,
    totalCost: 18590.54,
    realizedProfitLoss: 775.96,
    unrealizedProfitLoss: -3977.26,
  },
};

const POSITIONS = [
  {
    instrument: { ticker: 'VUAAm_EQ', name: 'Vanguard S&P 500', isin: 'IE00B3XXRP09', currency: 'CZK' },
    quantity: 1.19837494,
    averagePricePaid: 3200.5,
    currentPrice: 3112.1,
    walletImpact: { currentValue: 3729.36, totalCost: 4000, unrealizedProfitLoss: -270.64, currency: 'CZK' },
  },
];

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
}

function client(fetchImpl: typeof fetch): Trading212Client {
  return new Trading212Client({
    keyId: 'key-id',
    secret: 'the-secret',
    baseUrl: 'https://live.trading212.com',
    fetchImpl,
    sleep: async () => undefined,
  });
}

describe('Trading212Client authentication', () => {
  it('uses HTTP Basic with the key id as username and the secret as password', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(SUMMARY));

    await client(fetchImpl).getAccountSummary();

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;
    const authorization = headers?.Authorization ?? '';

    expect(authorization.startsWith('Basic ')).toBe(true);
    expect(Buffer.from(authorization.slice('Basic '.length), 'base64').toString()).toBe('key-id:the-secret');
  });

  it('does not fall back to the legacy raw-token header', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(SUMMARY));

    await client(fetchImpl).getAccountSummary();

    const headers = fetchImpl.mock.calls[0]?.[1]?.headers as Record<string, string> | undefined;

    expect(headers?.Authorization).not.toBe('the-secret');
  });

  it('refuses to be constructed without both halves of the credential', () => {
    expect(() => new Trading212Client({ keyId: '', secret: 's', baseUrl: 'https://x' })).toThrow(Trading212Error);
    expect(() => new Trading212Client({ keyId: 'k', secret: '', baseUrl: 'https://x' })).toThrow(Trading212Error);
  });

  it('never puts the credentials in an auth error message', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ error: 'nope' }, 401));

    await expect(client(fetchImpl).getAccountSummary()).rejects.toSatisfy(
      (error: unknown) => {
        const message = error instanceof Error ? error.message : '';

        return !message.includes('the-secret') && !message.includes('key-id') && message.includes('credentials');
      },
    );
  });
});

describe('Trading212Client endpoints', () => {
  it('calls the documented paths', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(POSITIONS));

    await client(fetchImpl).getPositions();

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://live.trading212.com/api/v0/equity/positions');
  });

  it('strips a trailing slash from the base URL', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse(SUMMARY));

    await new Trading212Client({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com/',
      fetchImpl,
      sleep: async () => undefined,
    }).getAccountSummary();

    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://live.trading212.com/api/v0/equity/account/summary');
  });

  it('parses the account summary', async () => {
    const summary = await client((async () => jsonResponse(SUMMARY)) as unknown as typeof fetch).getAccountSummary();

    expect(summary.totalValue).toBe(14613.28);
    expect(summary.currency).toBe('CZK');
    expect(summary.investments.unrealizedProfitLoss).toBe(-3977.26);
  });

  it('parses positions with their nested instrument', async () => {
    const positions = await client((async () => jsonResponse(POSITIONS)) as unknown as typeof fetch).getPositions();

    expect(positions[0]?.instrument.ticker).toBe('VUAAm_EQ');
    expect(positions[0]?.walletImpact.currentValue).toBe(3729.36);
  });

  it('tolerates unknown extra fields', async () => {
    const withExtras = { ...SUMMARY, somethingNew: 'ignored' };

    await expect(
      client((async () => jsonResponse(withExtras)) as unknown as typeof fetch).getAccountSummary(),
    ).resolves.toMatchObject({ totalValue: 14613.28 });
  });

  it('fails loudly when a required field disappears', async () => {
    const withoutTotal: Record<string, unknown> = { ...SUMMARY };
    delete withoutTotal.totalValue;

    await expect(
      client((async () => jsonResponse(withoutTotal)) as unknown as typeof fetch).getAccountSummary(),
    ).rejects.toBeInstanceOf(Trading212Error);
  });

  it('fetches a whole snapshot in one call', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (url) =>
      String(url).endsWith('account/summary') ? jsonResponse(SUMMARY) : jsonResponse(POSITIONS),
    );

    const snapshot = await client(fetchImpl).getSnapshot();

    expect(snapshot.summary.currency).toBe('CZK');
    expect(snapshot.positions).toHaveLength(1);
  });
});

describe('Trading212Client rate limiting', () => {
  it('retries and honours retry-after', async () => {
    const sleep = vi.fn(async () => undefined);
    let calls = 0;

    const fetchImpl = vi.fn<typeof fetch>(async () => {
      calls += 1;

      return calls === 1 ? jsonResponse({}, 429, { 'retry-after': '7' }) : jsonResponse(SUMMARY);
    });

    const summary = await new Trading212Client({
      keyId: 'k',
      secret: 's',
      baseUrl: 'https://live.trading212.com',
      fetchImpl,
      sleep,
    }).getAccountSummary();

    expect(summary.totalValue).toBe(14613.28);
    expect(sleep).toHaveBeenCalledWith(7000);
  });

  it('gives up after repeated rate limiting', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({}, 429));

    await expect(client(fetchImpl).getAccountSummary()).rejects.toMatchObject({
      status: 429,
    });
  });
});

describe('Trading212Client dividends and interest history', () => {
  const DIVIDEND = {
    amount: 42.5,
    currency: 'CZK',
    paidOn: '2026-07-15T00:00:00Z',
    ticker: 'VUAAm_EQ',
    reference: 'dividend-ref-1',
  };

  const INTEREST = {
    amount: 0.57,
    currency: 'CZK',
    dateTime: '2026-07-31T00:00:00Z',
    reference: 'interest-ref-1',
    type: 'INTEREST_ON_FREE_CASH' as const,
  };

  it('fetches a single page of dividends', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ items: [DIVIDEND], nextPagePath: null }));

    const dividends = await client(fetchImpl).getDividends();

    expect(dividends).toEqual([DIVIDEND]);
    expect(fetchImpl.mock.calls[0]?.[0]).toBe('https://live.trading212.com/api/v0/equity/history/dividends?limit=50');
  });

  it('follows nextPagePath until it is null', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;

      return call === 1
        ? jsonResponse({ items: [DIVIDEND], nextPagePath: '/api/v0/equity/history/dividends?limit=50&cursor=abc' })
        : jsonResponse({ items: [{ ...DIVIDEND, reference: 'dividend-ref-2' }], nextPagePath: null });
    });

    const dividends = await client(fetchImpl).getDividends();

    expect(dividends.map((item) => item.reference)).toEqual(['dividend-ref-1', 'dividend-ref-2']);
    expect(fetchImpl.mock.calls[1]?.[0]).toBe('https://live.trading212.com/api/v0/equity/history/dividends?limit=50&cursor=abc');
  });

  it('follows a bare query-string nextPagePath, not only a full path', async () => {
    // A real history/transactions response returned exactly this shape:
    // "limit=50&cursor=..." with no leading path or "?" at all — undocumented,
    // verified against a live account.
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      call += 1;

      if (call === 1) {
        return jsonResponse({ items: [INTEREST], nextPagePath: 'limit=50&cursor=abc123' });
      }

      expect(String(url)).toBe(
        'https://live.trading212.com/api/v0/equity/history/transactions?limit=50&cursor=abc123',
      );

      return jsonResponse({ items: [], nextPagePath: null });
    });

    const history = await client(fetchImpl).getTransactionHistory();

    expect(history).toEqual([INTEREST]);
    expect(call).toBe(2);
  });

  it('follows an absolute URL nextPagePath by stripping the known base URL', async () => {
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async (url) => {
      call += 1;

      if (call === 1) {
        return jsonResponse({
          items: [DIVIDEND],
          nextPagePath: 'https://live.trading212.com/api/v0/equity/history/dividends?limit=50&cursor=xyz',
        });
      }

      expect(String(url)).toBe('https://live.trading212.com/api/v0/equity/history/dividends?limit=50&cursor=xyz');

      return jsonResponse({ items: [], nextPagePath: null });
    });

    await client(fetchImpl).getDividends();
    expect(call).toBe(2);
  });

  it('paces pagination for the 6-per-minute history limit, not the 5s snapshot limit', async () => {
    const sleep = vi.fn(async () => undefined);
    let call = 0;
    const fetchImpl = vi.fn<typeof fetch>(async () => {
      call += 1;

      return call === 1
        ? jsonResponse({ items: [DIVIDEND], nextPagePath: '/api/v0/equity/history/dividends?limit=50&cursor=x' })
        : jsonResponse({ items: [], nextPagePath: null });
    });

    await new Trading212Client({ keyId: 'k', secret: 's', baseUrl: 'https://live.trading212.com', fetchImpl, sleep })
      .getDividends();

    expect(sleep).toHaveBeenCalledWith(10_000);
  });

  it('stops at the safety cap rather than paginating forever', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () =>
      jsonResponse({ items: [DIVIDEND], nextPagePath: '/api/v0/equity/history/dividends?limit=50&cursor=next' }),
    );

    const dividends = await client(fetchImpl).getDividends(3);

    expect(dividends).toHaveLength(3);
  });

  it('fetches transaction history and keeps every declared type', async () => {
    const fetchImpl = vi.fn<typeof fetch>(async () => jsonResponse({ items: [INTEREST], nextPagePath: null }));

    const history = await client(fetchImpl).getTransactionHistory();

    expect(history).toEqual([INTEREST]);
  });
});

describe('toDecimalString', () => {
  it('converts a JSON number exactly once, before it meets Decimal', () => {
    expect(toDecimalString(14613.28)).toBe('14613.2800');
    expect(toDecimalString(-3977.26)).toBe('-3977.2600');
  });

  it('rejects a non-finite number instead of writing NaN to the database', () => {
    expect(() => toDecimalString(Number.NaN)).toThrow();
    expect(() => toDecimalString(Number.POSITIVE_INFINITY)).toThrow();
  });
});
