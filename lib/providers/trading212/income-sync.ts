import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { buildIdempotencyKey } from '@/lib/finance/idempotency';

import { Trading212Client, Trading212Error } from './client';
import { toDecimalString } from './schemas';

/**
 * Pulls dividend payouts and cash interest from Trading 212 and stores them as
 * real ledger rows — a "dedicated stream" for passive income, as opposed to
 * `sync.ts`'s `AccountSnapshot`, which only ever holds a point-in-time
 * valuation. The account is `type: INVESTMENT`, so these rows do not change
 * `net-worth.ts`'s figure for it (investment accounts are valued purely from
 * the snapshot) — they only make the income visible in the ledger and the
 * settlement, which is the point.
 */

export interface IncomeSyncResult {
  dividendsFound: number;
  interestFound: number;
  bankTransfersFound: number;
  inserted: number;
}

export class Trading212IncomeSyncError extends Error {
  constructor(
    message: string,
    readonly code: 'NO_ACCOUNT' | 'AMBIGUOUS_ACCOUNT' | 'ACCOUNT_MISMATCH' | 'MISSING_CATEGORY' | 'API_ERROR',
  ) {
    super(message);
    this.name = 'Trading212IncomeSyncError';
  }
}

export interface IncomeSyncOptions {
  keyId: string;
  secret: string;
  baseUrl: string;
  client?: Trading212Client;
}

export async function syncTrading212Income(options: IncomeSyncOptions): Promise<IncomeSyncResult> {
  const accounts = await prisma.account.findMany({
    where: { provider: 'TRADING212', isArchived: false },
  });

  if (accounts.length === 0) {
    throw new Trading212IncomeSyncError(
      'No Trading 212 account exists in Orbit. Create one in Settings first.',
      'NO_ACCOUNT',
    );
  }

  if (accounts.length > 1) {
    throw new Trading212IncomeSyncError(
      'Multiple active Trading 212 accounts exist in Orbit. Archive all but one before syncing.',
      'AMBIGUOUS_ACCOUNT',
    );
  }

  const account = accounts[0];

  const categories = await prisma.category.findMany({
    where: { key: { in: ['dividends', 'interest', 'transfer'] } },
    select: { id: true, key: true },
  });

  const dividendCategoryId = categories.find((category) => category.key === 'dividends')?.id;
  const interestCategoryId = categories.find((category) => category.key === 'interest')?.id;
  const transferCategoryId = categories.find((category) => category.key === 'transfer')?.id;

  if (!dividendCategoryId || !interestCategoryId || !transferCategoryId) {
    throw new Trading212IncomeSyncError(
      'Systémové kategorie dividends/interest/transfer chybí — spusťte seed.',
      'MISSING_CATEGORY',
    );
  }

  const client =
    options.client ??
    new Trading212Client({ keyId: options.keyId, secret: options.secret, baseUrl: options.baseUrl });

  const { summary, dividends, interest, bankTransfers } = await (async () => {
    try {
      const summary = await client.getAccountSummary();
      const [dividendItems, transactionItems] = await Promise.all([client.getDividends(), client.getTransactionHistory()]);

      return {
        summary,
        dividends: dividendItems,
        interest: transactionItems.filter((item) => item.type === 'INTEREST_ON_FREE_CASH'),
        bankTransfers: transactionItems.filter((item) => item.type === 'DEPOSIT' || item.type === 'WITHDRAW'),
      };
    } catch (error: unknown) {
      if (error instanceof Trading212Error) {
        throw new Trading212IncomeSyncError(error.message, 'API_ERROR');
      }

      throw error;
    }
  })();

  const providerAccountId = String(summary.id);
  if (account.externalId && account.externalId !== providerAccountId) {
    throw new Trading212IncomeSyncError(
      `Trading 212 reports account ${summary.id}, but Orbit is bound to ${account.externalId}. Fix the account before syncing.`,
      'ACCOUNT_MISMATCH',
    );
  }

  if (!account.externalId) {
    await prisma.account.update({ where: { id: account.id }, data: { externalId: providerAccountId } });
  }

  const rows = [
    ...dividends.map((item) => {
      const date = new Date(item.paidOn);
      const currency = item.currency.toUpperCase();
      const amount = toDecimalString(item.amount);

      return {
        idempotencyKey: buildIdempotencyKey({
          provider: 'TRADING212' as const,
          externalId: item.reference,
          accountId: account.id,
          date,
          amount,
          currency,
          merchant: item.ticker,
        }),
        externalId: item.reference,
        accountId: account.id,
        source: 'API' as const,
        kind: 'NORMAL' as const,
        date,
        amount: new Prisma.Decimal(amount),
        currency,
        amountCzk: currency === 'CZK' ? new Prisma.Decimal(amount) : null,
        merchant: item.ticker,
        description: 'Dividenda',
        categoryId: dividendCategoryId,
        rawData: item,
      };
    }),
    ...interest.map((item) => {
      const date = new Date(item.dateTime);
      const currency = item.currency.toUpperCase();
      const amount = toDecimalString(item.amount);

      return {
        idempotencyKey: buildIdempotencyKey({
          provider: 'TRADING212' as const,
          externalId: item.reference,
          accountId: account.id,
          date,
          amount,
          currency,
          merchant: 'Trading 212',
        }),
        externalId: item.reference,
        accountId: account.id,
        source: 'API' as const,
        kind: 'NORMAL' as const,
        date,
        amount: new Prisma.Decimal(amount),
        currency,
        amountCzk: currency === 'CZK' ? new Prisma.Decimal(amount) : null,
        merchant: 'Trading 212',
        description: 'Úrok z volné hotovosti',
        categoryId: interestCategoryId,
        rawData: item,
      };
    }),
    ...bankTransfers.map((item) => {
      const date = new Date(item.dateTime);
      const currency = item.currency.toUpperCase();
      const amount = toDecimalString(item.amount);
      const isDeposit = item.type === 'DEPOSIT';

      return {
        idempotencyKey: buildIdempotencyKey({
          provider: 'TRADING212' as const,
          externalId: item.reference,
          accountId: account.id,
          date,
          amount,
          currency,
          merchant: 'Trading 212',
        }),
        externalId: item.reference,
        accountId: account.id,
        source: 'API' as const,
        kind: 'PENDING_TRANSFER' as const,
        date,
        amount: new Prisma.Decimal(amount),
        currency,
        amountCzk: currency === 'CZK' ? new Prisma.Decimal(amount) : null,
        merchant: 'Trading 212',
        description: isDeposit ? 'Vklad do Trading 212' : 'Výběr z Trading 212',
        categoryId: transferCategoryId,
        rawData: item,
      };
    }),
  ];

  const created =
    rows.length > 0 ? await prisma.transaction.createMany({ skipDuplicates: true, data: rows }) : { count: 0 };

  return {
    dividendsFound: dividends.length,
    interestFound: interest.length,
    bankTransfersFound: bankTransfers.length,
    inserted: created.count,
  };
}
