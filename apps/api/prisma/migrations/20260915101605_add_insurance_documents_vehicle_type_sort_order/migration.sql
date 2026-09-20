-- CreateEnum
CREATE TYPE "VehicleCategory" AS ENUM ('CAR', 'MOTORCYCLE', 'TRUCK_OR_TRACTOR', 'MOPED', 'BUS', 'TRAILER', 'OTHER');

-- CreateEnum
CREATE TYPE "InsuranceDocumentKind" AS ENUM ('CONTRACT', 'GREEN_CARD');

-- AlterTable
ALTER TABLE "InsurancePolicy" ADD COLUMN     "sortOrder" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "vehicleType" "VehicleCategory" NOT NULL DEFAULT 'CAR';

-- CreateTable
CREATE TABLE "InsurancePolicyDocument" (
    "id" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "kind" "InsuranceDocumentKind" NOT NULL,
    "filename" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "bytes" BYTEA NOT NULL,
    "sourceFileHash" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InsurancePolicyDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicyDocument_sourceFileHash_key" ON "InsurancePolicyDocument"("sourceFileHash");

-- CreateIndex
CREATE INDEX "InsurancePolicyDocument_policyId_kind_idx" ON "InsurancePolicyDocument"("policyId", "kind");

-- AddForeignKey
ALTER TABLE "InsurancePolicyDocument" ADD CONSTRAINT "InsurancePolicyDocument_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "InsurancePolicy"("id") ON DELETE CASCADE ON UPDATE CASCADE;
