-- AlterTable
ALTER TABLE "Account" ADD COLUMN     "openingBalance" DECIMAL(18,4) NOT NULL DEFAULT 0,
ADD COLUMN     "openingBalanceDate" TIMESTAMP(3);

