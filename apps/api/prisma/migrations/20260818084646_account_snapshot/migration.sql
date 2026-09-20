-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "balance" DECIMAL(18,4) NOT NULL,
    "cashBalance" DECIMAL(18,4),
    "investedValue" DECIMAL(18,4),
    "unrealizedPnl" DECIMAL(18,4),
    "balanceCzk" DECIMAL(18,4),
    "fxRate" DECIMAL(18,8),
    "rawData" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AccountSnapshot_capturedAt_idx" ON "AccountSnapshot"("capturedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AccountSnapshot_accountId_capturedAt_key" ON "AccountSnapshot"("accountId", "capturedAt");

-- AddForeignKey
ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "Account"("id") ON DELETE CASCADE ON UPDATE CASCADE;

