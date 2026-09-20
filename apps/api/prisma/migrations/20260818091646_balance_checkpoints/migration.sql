-- CreateEnum
CREATE TYPE "SnapshotSource" AS ENUM ('PROVIDER', 'MANUAL');

-- AlterTable
ALTER TABLE "Account" DROP COLUMN "openingBalance",
DROP COLUMN "openingBalanceDate";

-- AlterTable
ALTER TABLE "AccountSnapshot" ADD COLUMN     "expectedBalance" DECIMAL(18,4),
ADD COLUMN     "note" TEXT,
ADD COLUMN     "source" "SnapshotSource" NOT NULL DEFAULT 'PROVIDER';

