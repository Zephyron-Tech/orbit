-- CreateEnum
CREATE TYPE "TransactionKind" AS ENUM ('NORMAL', 'INTERNAL_TRANSFER', 'SETTLEMENT');

-- AlterTable
ALTER TABLE "Transaction" ADD COLUMN     "kind" "TransactionKind" NOT NULL DEFAULT 'NORMAL';

-- CreateIndex
CREATE INDEX "Transaction_kind_date_idx" ON "Transaction"("kind", "date");

