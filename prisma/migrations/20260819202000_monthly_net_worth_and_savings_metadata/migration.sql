ALTER TYPE "SnapshotSource" ADD VALUE 'STATEMENT';
ALTER TABLE "Account" ADD COLUMN "emergencyReserveMonths" INTEGER;
ALTER TABLE "Account" ADD COLUMN "annualInterestRate" DECIMAL(8,6);
ALTER TABLE "Account" ADD COLUMN "interestTaxRate" DECIMAL(5,4) NOT NULL DEFAULT 0.15;
ALTER TABLE "AccountSnapshot" ADD COLUMN "importBatchId" TEXT;
ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_importBatchId_fkey" FOREIGN KEY ("importBatchId") REFERENCES "ImportBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
CREATE INDEX "AccountSnapshot_importBatchId_idx" ON "AccountSnapshot"("importBatchId");
CREATE TABLE "MonthlyNetWorthSnapshot" (
  "id" TEXT NOT NULL,
  "month" TIMESTAMP(3) NOT NULL,
  "totalWorth" DECIMAL(18,4) NOT NULL,
  "cashValue" DECIMAL(18,4) NOT NULL,
  "investmentValue" DECIMAL(18,4) NOT NULL,
  "liabilityValue" DECIMAL(18,4) NOT NULL,
  "breakdown" JSONB NOT NULL,
  "isComplete" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MonthlyNetWorthSnapshot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MonthlyNetWorthSnapshot_month_key" ON "MonthlyNetWorthSnapshot"("month");
CREATE INDEX "MonthlyNetWorthSnapshot_month_idx" ON "MonthlyNetWorthSnapshot"("month");

UPDATE "AccountSnapshot" AS s
SET "source" = 'STATEMENT'
FROM "ImportBatch" AS b
WHERE s."accountId" = b."accountId"
  AND s."source" = 'MANUAL'
  AND s."note" = ('Import ' || b."filename")
  AND b."statementNumber" IS NOT NULL
  AND b."coverageTo" IS NOT NULL
  AND date_trunc('day', s."capturedAt") = b."coverageTo";

UPDATE "AccountSnapshot" AS s
SET "importBatchId" = b."id"
FROM "ImportBatch" AS b
WHERE s."accountId" = b."accountId"
  AND s."source" = 'STATEMENT'
  AND b."statementNumber" IS NOT NULL
  AND b."coverageTo" IS NOT NULL
  AND date_trunc('day', s."capturedAt") = b."coverageTo"
  AND s."note" = ('Import ' || b."filename");

ALTER TABLE "Account" ADD CONSTRAINT "Account_emergencyReserveMonths_savings_only" CHECK ("emergencyReserveMonths" IS NULL OR ("type" = 'SAVINGS' AND "emergencyReserveMonths" >= 1));
ALTER TABLE "Account" ADD CONSTRAINT "Account_annualInterestRate_savings_only" CHECK ("annualInterestRate" IS NULL OR ("type" = 'SAVINGS' AND "annualInterestRate" >= 0));
ALTER TABLE "Account" ADD CONSTRAINT "Account_interestTaxRate_range" CHECK ("interestTaxRate" >= 0 AND "interestTaxRate" <= 1);
