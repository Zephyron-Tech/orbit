-- CreateEnum
CREATE TYPE "NotificationType" AS ENUM ('INSURANCE_RENEWAL', 'PORTFOLIO_DIGEST', 'DCA_OVERDUE', 'RECURRING_EXPENSE_OVERDUE', 'UNMATCHED_TRANSFER_STUCK', 'STATEMENT_COVERAGE_GAP', 'FAILED_IMPORT_ROW', 'SETTLEMENT_NOT_CLOSED', 'DIVIDEND_RECEIVED', 'UNCATEGORIZED_PILEUP', 'BIG_PORTFOLIO_MOVE', 'CASH_BUFFER_LOW', 'CREDIT_UTILIZATION_HIGH', 'FUEL_RECEIPT_MISSING');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "notificationPreferences" JSONB NOT NULL DEFAULT '{"insuranceRenewal":true,"portfolioDigest":true,"dcaOverdue":true,"recurringExpenseOverdue":true,"unmatchedTransferStuck":true,"statementCoverageGap":true,"failedImportRow":true,"settlementNotClosed":true,"dividendReceived":true,"uncategorizedPileup":true,"bigPortfolioMove":true,"cashBufferLow":true,"creditUtilizationHigh":true,"fuelReceiptMissing":true}';

-- CreateTable
CREATE TABLE "SentNotification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "NotificationType" NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SentNotification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SentNotification_userId_type_sentAt_idx" ON "SentNotification"("userId", "type", "sentAt");

-- CreateIndex
CREATE UNIQUE INDEX "SentNotification_userId_type_dedupeKey_key" ON "SentNotification"("userId", "type", "dedupeKey");

-- AddForeignKey
ALTER TABLE "SentNotification" ADD CONSTRAINT "SentNotification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
