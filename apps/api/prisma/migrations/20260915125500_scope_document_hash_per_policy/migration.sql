-- DropIndex
DROP INDEX "InsurancePolicyDocument_sourceFileHash_key";

-- CreateIndex
CREATE UNIQUE INDEX "InsurancePolicyDocument_policyId_sourceFileHash_key" ON "InsurancePolicyDocument"("policyId", "sourceFileHash");
