ALTER TABLE "RecurringExpense" ADD COLUMN "merchantKey" TEXT;
CREATE INDEX "RecurringExpense_isActive_merchantKey_idx" ON "RecurringExpense"("isActive", "merchantKey");
