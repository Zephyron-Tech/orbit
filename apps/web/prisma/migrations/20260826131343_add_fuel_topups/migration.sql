-- CreateTable
CREATE TABLE "FuelTopUp" (
    "id" TEXT NOT NULL,
    "toppedUpAt" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL,
    "station" TEXT NOT NULL,
    "operationType" TEXT NOT NULL,
    "amountCzk" DECIMAL(18,4) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelTopUp_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FuelTopUp_idempotencyKey_key" ON "FuelTopUp"("idempotencyKey");
