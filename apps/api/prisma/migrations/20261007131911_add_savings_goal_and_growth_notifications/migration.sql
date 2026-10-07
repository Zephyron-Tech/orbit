-- AlterEnum
ALTER TYPE "NotificationType" ADD VALUE 'SAVINGS_GROWTH';
ALTER TYPE "NotificationType" ADD VALUE 'SAVINGS_STAGNANT';
ALTER TYPE "NotificationType" ADD VALUE 'SAVINGS_GOAL_REACHED';

-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "savingsGoalAmount" DECIMAL(18,4);

-- AlterTable: new default covers newly-created users; existing rows are
-- backfilled below so NotificationPreferencesSchema's .strict() parse never
-- sees a row missing the three new keys.
ALTER TABLE "User" ALTER COLUMN "notificationPreferences" SET DEFAULT '{"insuranceRenewal":true,"portfolioDigest":true,"dcaOverdue":true,"recurringExpenseOverdue":true,"unmatchedTransferStuck":true,"statementCoverageGap":true,"failedImportRow":true,"settlementNotClosed":true,"dividendReceived":true,"uncategorizedPileup":true,"bigPortfolioMove":true,"cashBufferLow":true,"creditUtilizationHigh":true,"fuelReceiptMissing":true,"savingsGrowth":true,"savingsStagnant":true,"savingsGoalReached":true}';

UPDATE "User" SET "notificationPreferences" = "notificationPreferences" || '{"savingsGrowth":true,"savingsStagnant":true,"savingsGoalReached":true}'::jsonb;
