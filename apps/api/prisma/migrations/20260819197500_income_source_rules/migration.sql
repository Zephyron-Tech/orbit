CREATE TABLE "IncomeSourceRule" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "merchantKey" TEXT NOT NULL,
  "accountId" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "IncomeSourceRule_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "IncomeSourceRule_merchantKey_accountId_key" ON "IncomeSourceRule"("merchantKey", "accountId");
CREATE INDEX "IncomeSourceRule_isActive_merchantKey_idx" ON "IncomeSourceRule"("isActive", "merchantKey");
ALTER TABLE "IncomeSourceRule" ADD CONSTRAINT "IncomeSourceRule_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
