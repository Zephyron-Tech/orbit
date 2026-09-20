CREATE TABLE "RecurringExpenseAlias" (
  "id" TEXT NOT NULL,
  "recurringExpenseId" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "merchantKey" TEXT NOT NULL,
  "learnedFromTransactionId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecurringExpenseAlias_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "RecurringExpenseAlias_accountId_merchantKey_key" ON "RecurringExpenseAlias"("accountId", "merchantKey");
CREATE INDEX "RecurringExpenseAlias_recurringExpenseId_idx" ON "RecurringExpenseAlias"("recurringExpenseId");
ALTER TABLE "RecurringExpenseAlias" ADD CONSTRAINT "RecurringExpenseAlias_recurringExpenseId_fkey" FOREIGN KEY ("recurringExpenseId") REFERENCES "RecurringExpense"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecurringExpenseAlias" ADD CONSTRAINT "RecurringExpenseAlias_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;
