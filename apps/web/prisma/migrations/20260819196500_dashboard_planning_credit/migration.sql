ALTER TABLE "Account" ADD COLUMN "creditLimit" DECIMAL(18,4);
ALTER TABLE "Account" ADD COLUMN "cardLast4" CHAR(4);
ALTER TABLE "RecurringExpense" ADD COLUMN "dueDay" INTEGER;
ALTER TABLE "RecurringExpense" ADD COLUMN "graceDays" INTEGER NOT NULL DEFAULT 3;
ALTER TABLE "RecurringExpense" ADD COLUMN "startsOn" TIMESTAMP(3);
ALTER TABLE "RecurringExpense" ADD COLUMN "endsOn" TIMESTAMP(3);
ALTER TABLE "RecurringExpense" ADD COLUMN "paymentAccountId" TEXT;
ALTER TABLE "NetWorthSnapshot" ADD COLUMN "creditAssetValue" DECIMAL(18,4) NOT NULL DEFAULT 0;

CREATE TABLE "PlanningSettings" (
  "id" TEXT NOT NULL DEFAULT 'household',
  "monthlySpendingTarget" DECIMAL(18,4),
  "currency" CHAR(3) NOT NULL DEFAULT 'CZK',
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "PlanningSettings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "RecurringInvestmentPlan" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "sourceAccountId" TEXT,
  "brokerAccountId" TEXT NOT NULL,
  "expectedAmount" DECIMAL(18,4) NOT NULL,
  "currency" CHAR(3) NOT NULL DEFAULT 'CZK',
  "dueDay" INTEGER NOT NULL,
  "graceDays" INTEGER NOT NULL DEFAULT 3,
  "startsOn" TIMESTAMP(3),
  "endsOn" TIMESTAMP(3),
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "RecurringInvestmentPlan_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_paymentAccountId_fkey" FOREIGN KEY ("paymentAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringInvestmentPlan" ADD CONSTRAINT "RecurringInvestmentPlan_sourceAccountId_fkey" FOREIGN KEY ("sourceAccountId") REFERENCES "Account"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "RecurringInvestmentPlan" ADD CONSTRAINT "RecurringInvestmentPlan_brokerAccountId_fkey" FOREIGN KEY ("brokerAccountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "RecurringInvestmentPlan_brokerAccountId_isActive_idx" ON "RecurringInvestmentPlan"("brokerAccountId", "isActive");

ALTER TABLE "Account" ADD CONSTRAINT "Account_creditLimit_credit_only" CHECK ("creditLimit" IS NULL OR ("type" = 'CREDIT' AND "creditLimit" >= 0));
ALTER TABLE "Account" ADD CONSTRAINT "Account_cardLast4_digits" CHECK ("cardLast4" IS NULL OR "cardLast4" ~ '^[0-9]{4}$');
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_dueDay_range" CHECK ("dueDay" IS NULL OR ("dueDay" BETWEEN 1 AND 31));
ALTER TABLE "RecurringExpense" ADD CONSTRAINT "RecurringExpense_graceDays_nonnegative" CHECK ("graceDays" >= 0);
ALTER TABLE "RecurringInvestmentPlan" ADD CONSTRAINT "RecurringInvestmentPlan_dueDay_range" CHECK ("dueDay" BETWEEN 1 AND 31);
ALTER TABLE "RecurringInvestmentPlan" ADD CONSTRAINT "RecurringInvestmentPlan_graceDays_nonnegative" CHECK ("graceDays" >= 0);
