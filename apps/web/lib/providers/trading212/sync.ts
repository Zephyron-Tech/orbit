import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

import { Trading212Client, Trading212Error } from './client';
import { toDecimalString } from './schemas';

/**
 * Pulls the current Trading 212 portfolio and stores it as an append-only
 * snapshot. A brokerage account's value moves with the market, so it cannot be
 * derived from transactions the way a bank account can — it has to be sampled.
 */

export interface SyncResult {
  accountId: string;
  /** Hour bucket this snapshot belongs to, for history grouping. Does not
   *  move on a same-hour refresh — see `updatedAt` for that. */
  capturedAt: string;
  /** When this call actually wrote fresh data. Always "now": every sync call
   *  fetches and stores live figures, regardless of the hour bucket. */
  updatedAt: string;
  currency: string;
  total: string;
  cash: string;
  invested: string;
  unrealizedPnl: string;
  positionCount: number;
  /** True when this hour's bucket already existed and was refreshed in place,
   *  rather than created. Informational only — data is fresh either way. */
  wasExisting: boolean;
}

export class Trading212SyncError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_ACCOUNT' | 'AMBIGUOUS_ACCOUNT' | 'ACCOUNT_MISMATCH' | 'CURRENCY_MISMATCH' | 'API_ERROR',
  ) {
    super(message);
    this.name = 'Trading212SyncError';
  }
}

/** Snapshots are taken at most once an hour; truncating keeps them idempotent. */
function truncateToHour(now: Date): Date {
  const truncated = new Date(now);
  truncated.setUTCMinutes(0, 0, 0);

  return truncated;
}

export interface SyncOptions {
  keyId: string;
  secret: string;
  baseUrl: string;
  /** Injected so the caller controls time; `lib/finance` purity rules by habit. */
  now?: Date;
  client?: Trading212Client;
}

export async function syncTrading212(options: SyncOptions): Promise<SyncResult> {
  const accounts = await prisma.account.findMany({
    where: { provider: 'TRADING212', isArchived: false },
  });

  if (accounts.length === 0) {
    throw new Trading212SyncError(
      'No Trading 212 account exists in Orbit. Create one in Settings first.',
      'NO_ACCOUNT',
    );
  }

  if (accounts.length > 1) {
    throw new Trading212SyncError(
      'Multiple active Trading 212 accounts exist in Orbit. Archive all but one before syncing.',
      'AMBIGUOUS_ACCOUNT',
    );
  }

  const account = accounts[0];

  const client =
    options.client ??
    new Trading212Client({ keyId: options.keyId, secret: options.secret, baseUrl: options.baseUrl });

  const snapshot = await (async () => {
    try {
      return await client.getSnapshot();
    } catch (error: unknown) {
      if (error instanceof Trading212Error) {
        throw new Trading212SyncError(error.message, 'API_ERROR');
      }

      throw error;
    }
  })();

  const currency = snapshot.summary.currency.toUpperCase();

  const providerAccountId = String(snapshot.summary.id);
  if (account.externalId && account.externalId !== providerAccountId) {
    throw new Trading212SyncError(
      `Trading 212 reports account ${snapshot.summary.id}, but Orbit is bound to ${account.externalId}. Fix the account before syncing.`,
      'ACCOUNT_MISMATCH',
    );
  }

  if (!account.externalId) {
    await prisma.account.update({ where: { id: account.id }, data: { externalId: providerAccountId } });
  }

  // The account's configured currency is what every downstream number assumes.
  if (account.currency.toUpperCase() !== currency) {
    throw new Trading212SyncError(
      `Trading 212 reports ${currency} but the account is configured as ${account.currency}. Fix the account before syncing.`,
      'CURRENCY_MISMATCH',
    );
  }

  const capturedAt = truncateToHour(options.now ?? new Date());

  const total = new Prisma.Decimal(toDecimalString(snapshot.summary.totalValue));
  // Free cash plus what is parked inside pies; both are uninvested money.
  const cash = new Prisma.Decimal(toDecimalString(snapshot.summary.cash.availableToTrade)).plus(
    new Prisma.Decimal(toDecimalString(snapshot.summary.cash.inPies)),
  );
  const invested = new Prisma.Decimal(toDecimalString(snapshot.summary.investments.currentValue));
  const unrealizedPnl = new Prisma.Decimal(toDecimalString(snapshot.summary.investments.unrealizedProfitLoss));

  const wasExisting =
    (await prisma.accountSnapshot.count({
      where: { accountId: account.id, capturedAt },
    })) > 0;

  const data = {
    currency,
    balance: total,
    cashBalance: cash,
    investedValue: invested,
    unrealizedPnl,
    // Only CZK accounts are directly comparable; anything else needs an FX
    // rate, which Orbit does not have a source for yet.
    balanceCzk: currency === 'CZK' ? total : null,
    rawData: {
      summary: snapshot.summary,
      positions: snapshot.positions,
    },
  };

  // The hour bucket keeps history from growing one row per click, but every
  // call fetched live data and must not throw it away: an update here is what
  // makes the "Obnovit" button, and a same-hour cron run, actually refresh the
  // number instead of silently keeping a stale one.
  const stored = await prisma.accountSnapshot.upsert({
    where: { accountId_capturedAt: { accountId: account.id, capturedAt } },
    update: data,
    create: { accountId: account.id, capturedAt, ...data },
  });

  return {
    accountId: account.id,
    capturedAt: capturedAt.toISOString(),
    updatedAt: stored.updatedAt.toISOString(),
    currency,
    total: total.toFixed(2),
    cash: cash.toFixed(2),
    invested: invested.toFixed(2),
    unrealizedPnl: unrealizedPnl.toFixed(2),
    positionCount: snapshot.positions.length,
    wasExisting,
  };
}
