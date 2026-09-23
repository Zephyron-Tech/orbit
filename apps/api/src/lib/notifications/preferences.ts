import { z } from 'zod';

import type { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

/**
 * The 14 notification types a user can independently toggle. This is the
 * single source of truth for the key names — `User.notificationPreferences`
 * (Json), the settings route, and every check in `checks/*.ts` all import
 * this schema rather than re-declaring the keys. `.strict()` rejects an
 * unknown key at parse time instead of silently dropping it, so a renamed
 * key surfaces as a loud error rather than a quietly-ignored toggle.
 */
export const NotificationPreferencesSchema = z
  .object({
    insuranceRenewal: z.boolean(),
    portfolioDigest: z.boolean(),
    dcaOverdue: z.boolean(),
    recurringExpenseOverdue: z.boolean(),
    unmatchedTransferStuck: z.boolean(),
    statementCoverageGap: z.boolean(),
    failedImportRow: z.boolean(),
    settlementNotClosed: z.boolean(),
    dividendReceived: z.boolean(),
    uncategorizedPileup: z.boolean(),
    bigPortfolioMove: z.boolean(),
    cashBufferLow: z.boolean(),
    creditUtilizationHigh: z.boolean(),
    fuelReceiptMissing: z.boolean(),
  })
  .strict();

export type NotificationPreferences = z.infer<typeof NotificationPreferencesSchema>;
export type NotificationPreferenceKey = keyof NotificationPreferences;

/** Maps each Prisma `NotificationType` enum value to its preference key — the one place the two vocabularies (DB enum, settings JSON) are bridged. */
export const PREFERENCE_KEY_BY_TYPE = {
  INSURANCE_RENEWAL: 'insuranceRenewal',
  PORTFOLIO_DIGEST: 'portfolioDigest',
  DCA_OVERDUE: 'dcaOverdue',
  RECURRING_EXPENSE_OVERDUE: 'recurringExpenseOverdue',
  UNMATCHED_TRANSFER_STUCK: 'unmatchedTransferStuck',
  STATEMENT_COVERAGE_GAP: 'statementCoverageGap',
  FAILED_IMPORT_ROW: 'failedImportRow',
  SETTLEMENT_NOT_CLOSED: 'settlementNotClosed',
  DIVIDEND_RECEIVED: 'dividendReceived',
  UNCATEGORIZED_PILEUP: 'uncategorizedPileup',
  BIG_PORTFOLIO_MOVE: 'bigPortfolioMove',
  CASH_BUFFER_LOW: 'cashBufferLow',
  CREDIT_UTILIZATION_HIGH: 'creditUtilizationHigh',
  FUEL_RECEIPT_MISSING: 'fuelReceiptMissing',
} as const satisfies Record<NotificationType, NotificationPreferenceKey>;

export const NotificationPreferencesPatchSchema = NotificationPreferencesSchema.partial();

/**
 * Parses the raw `User.notificationPreferences` Json column. The column has
 * a full-object DB default, so this should always be a complete, valid
 * object — throwing loudly on a mismatch surfaces a real bug (e.g. a schema
 * drift after a rename) instead of silently falling back to defaults.
 */
export function parseNotificationPreferences(raw: unknown): NotificationPreferences {
  return NotificationPreferencesSchema.parse(raw);
}
