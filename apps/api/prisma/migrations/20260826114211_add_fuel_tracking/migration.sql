-- CreateTable
CREATE TABLE "FuelPurchase" (
    "id" TEXT NOT NULL,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "stationCode" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "product" TEXT NOT NULL,
    "quantityLiters" DECIMAL(10,3) NOT NULL,
    "amountCzk" DECIMAL(18,4) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "rawData" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelPurchase_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelReceipt" (
    "id" TEXT NOT NULL,
    "purchaseId" TEXT,
    "purchasedAt" TIMESTAMP(3) NOT NULL,
    "stationCode" TEXT NOT NULL,
    "stationName" TEXT NOT NULL,
    "docNumber" TEXT NOT NULL,
    "transactionCode" TEXT,
    "quantityLiters" DECIMAL(10,3) NOT NULL,
    "pricePerLiter" DECIMAL(10,4) NOT NULL,
    "grossBeforeDiscount" DECIMAL(18,4) NOT NULL,
    "discountLabel" TEXT,
    "discountAmount" DECIMAL(18,4) NOT NULL DEFAULT 0,
    "totalAfterDiscount" DECIMAL(18,4) NOT NULL,
    "cardLast4" TEXT NOT NULL,
    "sourceFileHash" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FuelImportBatch" (
    "id" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "insertedCount" INTEGER NOT NULL,
    "skippedCount" INTEGER NOT NULL,
    "failedCount" INTEGER NOT NULL,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FuelImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "FuelPurchase_idempotencyKey_key" ON "FuelPurchase"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "FuelReceipt_purchaseId_key" ON "FuelReceipt"("purchaseId");

-- CreateIndex
CREATE UNIQUE INDEX "FuelReceipt_docNumber_key" ON "FuelReceipt"("docNumber");

-- CreateIndex
CREATE UNIQUE INDEX "FuelReceipt_sourceFileHash_key" ON "FuelReceipt"("sourceFileHash");

-- CreateIndex
CREATE UNIQUE INDEX "FuelImportBatch_fileHash_key" ON "FuelImportBatch"("fileHash");

-- AddForeignKey
ALTER TABLE "FuelReceipt" ADD CONSTRAINT "FuelReceipt_purchaseId_fkey" FOREIGN KEY ("purchaseId") REFERENCES "FuelPurchase"("id") ON DELETE SET NULL ON UPDATE CASCADE;
