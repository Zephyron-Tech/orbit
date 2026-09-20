/*
  Warnings:

  - You are about to drop the column `merchantKey` on the `RecurringExpense` table. All the data in the column will be lost.

*/
-- CreateEnum
CREATE TYPE "PaymentFrequency" AS ENUM ('ANNUAL', 'SEMI_ANNUAL', 'MONTHLY');

-- CreateEnum
CREATE TYPE "PolicyStatus" AS ENUM ('ACTIVE', 'PAID', 'PENDING_RENEWAL', 'TERMINATED');

-- DropIndex
DROP INDEX "RecurringExpense_isActive_merchantKey_idx";

-- AlterTable
ALTER TABLE "Account" ALTER COLUMN "interestTaxRate" DROP NOT NULL;

-- AlterTable
ALTER TABLE "RecurringExpense" DROP COLUMN "merchantKey";

-- CreateTable
CREATE TABLE "InsurancePolicy" (
    "id" TEXT NOT NULL,
    "vehicleName" TEXT NOT NULL,
    "licensePlate" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "policyHolder" TEXT NOT NULL,
    "annualCost" DECIMAL(18,4) NOT NULL,
    "paymentFrequency" "PaymentFrequency" NOT NULL DEFAULT 'ANNUAL',
    "startDate" TIMESTAMP(3) NOT NULL,
    "status" "PolicyStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InsurancePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicy_policyNumber_key" ON "InsurancePolicy"("policyNumber");
