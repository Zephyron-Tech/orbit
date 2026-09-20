import { z } from 'zod';

/**
 * Trading 212 Public API v0, equity endpoints.
 *
 * Shapes follow the official OpenAPI document (api.json in the repository
 * root). Fields the sync uses are required so a silent contract change fails
 * loudly; everything else is optional, so an added field cannot break a
 * nightly job.
 */

/** GET /api/v0/equity/account/summary — `cash` */
export const cashSchema = z.object({
  availableToTrade: z.number(),
  inPies: z.number(),
  reservedForOrders: z.number(),
});

/** GET /api/v0/equity/account/summary — `investments` */
export const investmentsSchema = z.object({
  currentValue: z.number(),
  totalCost: z.number(),
  realizedProfitLoss: z.number(),
  unrealizedProfitLoss: z.number(),
});

export const accountSummarySchema = z.object({
  id: z.number(),
  currency: z.string().length(3),
  totalValue: z.number(),
  cash: cashSchema,
  investments: investmentsSchema,
});

export type AccountSummary = z.infer<typeof accountSummarySchema>;

const instrumentSchema = z.object({
  ticker: z.string(),
  name: z.string().optional(),
  isin: z.string().optional(),
  currency: z.string().optional(),
});

const walletImpactSchema = z.object({
  currentValue: z.number(),
  totalCost: z.number(),
  unrealizedProfitLoss: z.number(),
  fxImpact: z.number().optional(),
  currency: z.string().optional(),
});

/** GET /api/v0/equity/positions */
export const positionSchema = z.object({
  instrument: instrumentSchema,
  quantity: z.number(),
  averagePricePaid: z.number(),
  currentPrice: z.number(),
  walletImpact: walletImpactSchema,
  quantityAvailableForTrading: z.number().optional(),
  quantityInPies: z.number().optional(),
  createdAt: z.string().optional(),
});

export type Position = z.infer<typeof positionSchema>;

export const positionsSchema = z.array(positionSchema);

/** GET /api/v0/equity/history/dividends — one paid-out dividend. */
export const dividendItemSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  paidOn: z.string(),
  ticker: z.string(),
  /** Unique per event; this is what the idempotency key is built from. */
  reference: z.string(),
  quantity: z.number().optional(),
  grossAmountPerShare: z.number().optional(),
});

export type DividendItem = z.infer<typeof dividendItemSchema>;

export const dividendsPageSchema = z.object({
  items: z.array(dividendItemSchema),
  nextPagePath: z.string().nullable(),
});

/**
 * GET /api/v0/equity/history/transactions — one cash movement.
 *
 * Income sync uses `INTEREST_ON_FREE_CASH`; `WITHDRAW` and `DEPOSIT` become
 * internal-transfer ledger rows. Trades and fees remain out of scope.
 */
export const transactionHistoryItemSchema = z.object({
  amount: z.number(),
  currency: z.string(),
  dateTime: z.string(),
  reference: z.string(),
  type: z.enum(['WITHDRAW', 'DEPOSIT', 'FEE', 'TRANSFER', 'INTEREST_ON_FREE_CASH', 'LENDING_INTEREST']),
});

export type TransactionHistoryItem = z.infer<typeof transactionHistoryItemSchema>;

export const transactionHistoryPageSchema = z.object({
  items: z.array(transactionHistoryItemSchema),
  nextPagePath: z.string().nullable(),
});

/**
 * JSON numbers are IEEE-754 doubles, so a value is turned into a string exactly
 * once, here, before it becomes a `Decimal`. Formatting it any later would bake
 * in the drift the `Decimal` was chosen to avoid.
 */
export function toDecimalString(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`Trading 212 returned a non-finite number: ${String(value)}`);
  }

  return value.toFixed(4);
}
