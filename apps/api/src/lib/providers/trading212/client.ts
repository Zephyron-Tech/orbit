import { z } from 'zod';

import {
  accountSummarySchema,
  dividendsPageSchema,
  positionsSchema,
  transactionHistoryPageSchema,
  type AccountSummary,
  type DividendItem,
  type Position,
  type TransactionHistoryItem,
} from './schemas';

/**
 * Minimal Trading 212 REST client, read-only.
 *
 * Authentication is HTTP Basic: the API **key id** is the username and the API
 * **secret** is the password. The older scheme of putting a raw token in the
 * Authorization header is marked `legacyApiKeyHeader` in the specification and
 * is not used here.
 *
 * The API is rate limited per endpoint and answers 429 when a call comes too
 * soon, so requests are spaced and retried rather than fired in parallel.
 */

export class Trading212Error extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly endpoint: string,
  ) {
    super(message);
    this.name = 'Trading212Error';
  }
}

export interface Trading212Config {
  /** API key id — the Basic auth username. */
  keyId: string;
  /** API secret — the Basic auth password. */
  secret: string;
  baseUrl: string;
  /** Injected in tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
  /** Injected in tests so retries do not actually wait. */
  sleep?: (ms: number) => Promise<void>;
}

const MAX_RETRIES = 3;
const RETRY_BASE_MS = 2_000;
/** history/dividends and history/transactions allow 6 requests per minute. */
const HISTORY_REQUEST_SPACING_MS = 10_000;
const PAGE_SIZE = 50;
/** Safety cap on pagination — dividend and interest history is sparse. */
const MAX_HISTORY_ITEMS = 500;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export interface Trading212Snapshot {
  summary: AccountSummary;
  positions: Position[];
}

export class Trading212Client {
  private readonly authorization: string;
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(config: Trading212Config) {
    if (!config.keyId || !config.secret) {
      throw new Trading212Error(
        'Both TRADING212_API_KEY_ID and TRADING212_API_SECRET must be set',
        0,
        '',
      );
    }

    this.authorization = `Basic ${Buffer.from(`${config.keyId}:${config.secret}`).toString('base64')}`;
    this.baseUrl = config.baseUrl.replace(/\/$/, '');
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.sleep = config.sleep ?? defaultSleep;
  }

  private request<T>(endpoint: string, schema: z.ZodType<T>): Promise<T> {
    return this.requestPath(`/api/v0/equity/${endpoint}`, endpoint, schema);
  }

  /**
   * Same retry/parse logic as `request`, but takes a full path rather than an
   * endpoint name — needed for pagination, where the server hands back the
   * exact next path (`nextPagePath`) to follow verbatim.
   */
  private async requestPath<T>(path: string, endpointLabel: string, schema: z.ZodType<T>): Promise<T> {
    let lastStatus = 0;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt += 1) {
      const response = await this.fetchImpl(`${this.baseUrl}${path}`, {
        headers: {
          Authorization: this.authorization,
          Accept: 'application/json',
        },
        cache: 'no-store',
      });

      lastStatus = response.status;

      if (response.status === 429) {
        // Respect the server's own backoff hint when it sends one.
        const retryAfter = Number(response.headers.get('retry-after'));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : RETRY_BASE_MS * (attempt + 1);

        await this.sleep(waitMs);
        continue;
      }

      if (response.status === 401 || response.status === 403) {
        // Never include the credentials or the body: both can carry secrets.
        throw new Trading212Error(
          'Trading 212 rejected the credentials. Check the key id, the secret and the key scopes.',
          response.status,
          endpointLabel,
        );
      }

      if (!response.ok) {
        throw new Trading212Error(`Trading 212 returned ${response.status}`, response.status, endpointLabel);
      }

      const payload: unknown = await response.json();
      const parsed = schema.safeParse(payload);

      if (!parsed.success) {
        throw new Trading212Error(
          `Unexpected response shape from ${endpointLabel}: ${parsed.error.issues
            .map((issue) => issue.path.join('.'))
            .join(', ')}`,
          response.status,
          endpointLabel,
        );
      }

      return parsed.data;
    }

    throw new Trading212Error('Trading 212 rate limit exceeded', lastStatus, endpointLabel);
  }

  getAccountSummary(): Promise<AccountSummary> {
    return this.request('account/summary', accountSummarySchema);
  }

  getPositions(): Promise<Position[]> {
    return this.request('positions', positionsSchema);
  }

  /**
   * account/summary (1/5s) and positions (1/1s) are separate rate-limit
   * buckets and each is only ever called once per snapshot, so there is
   * nothing to space between them — only repeated calls to the *same*
   * endpoint need the gap, which `requestPath`'s own 429 retry handles.
   */
  async getSnapshot(): Promise<Trading212Snapshot> {
    const summary = await this.getAccountSummary();
    const positions = await this.getPositions();

    return { summary, positions };
  }

  private getDividendsPage(path: string): Promise<{ items: DividendItem[]; nextPagePath: string | null }> {
    return this.requestPath(path, 'history/dividends', dividendsPageSchema);
  }

  private getTransactionHistoryPage(
    path: string,
  ): Promise<{ items: TransactionHistoryItem[]; nextPagePath: string | null }> {
    return this.requestPath(path, 'history/transactions', transactionHistoryPageSchema);
  }

  /**
   * `nextPagePath` does not reliably match the documented shape (a full path
   * like `/api/v0/equity/history/orders?cursor=...`). A real `history/
   * transactions` response instead returned the bare query string with no
   * leading path or `?` at all: `limit=50&cursor=...`. Handle every shape seen
   * or plausible — full path, absolute URL, bare query string — by always
   * reconstructing against the endpoint's own canonical path.
   */
  private resolveNextPath(endpointPath: string, nextPagePath: string): string {
    if (/^https?:\/\//i.test(nextPagePath)) {
      return nextPagePath.startsWith(this.baseUrl) ? nextPagePath.slice(this.baseUrl.length) : nextPagePath;
    }

    if (nextPagePath.startsWith('/')) {
      return nextPagePath;
    }

    const query = nextPagePath.startsWith('?') ? nextPagePath : `?${nextPagePath}`;

    return `${endpointPath}${query}`;
  }

  /**
   * Follows `nextPagePath` until the server says there is nothing left, or
   * `maxItems` is reached — a safety cap, not an expected outcome: dividend and
   * interest history are sparse compared to a bank statement.
   */
  private async fetchAllPages<T>(
    endpointPath: string,
    firstPath: string,
    getPage: (path: string) => Promise<{ items: T[]; nextPagePath: string | null }>,
    maxItems: number,
  ): Promise<T[]> {
    const items: T[] = [];
    let path: string | null = firstPath;

    while (path && items.length < maxItems) {
      const page = await getPage(path);
      items.push(...page.items);
      path = page.nextPagePath ? this.resolveNextPath(endpointPath, page.nextPagePath) : null;

      if (path) {
        await this.sleep(HISTORY_REQUEST_SPACING_MS);
      }
    }

    return items;
  }

  /** All dividend payouts, oldest and newest alike — the caller dedupes by reference. */
  getDividends(maxItems = MAX_HISTORY_ITEMS): Promise<DividendItem[]> {
    const endpointPath = '/api/v0/equity/history/dividends';

    return this.fetchAllPages(
      endpointPath,
      `${endpointPath}?limit=${PAGE_SIZE}`,
      (path) => this.getDividendsPage(path),
      maxItems,
    );
  }

  /** Every cash movement; the caller filters down to the types it cares about. */
  getTransactionHistory(maxItems = MAX_HISTORY_ITEMS): Promise<TransactionHistoryItem[]> {
    const endpointPath = '/api/v0/equity/history/transactions';

    return this.fetchAllPages(
      endpointPath,
      `${endpointPath}?limit=${PAGE_SIZE}`,
      (path) => this.getTransactionHistoryPage(path),
      maxItems,
    );
  }
}
