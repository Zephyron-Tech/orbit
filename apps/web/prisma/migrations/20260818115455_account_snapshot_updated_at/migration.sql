-- Backfill existing rows before enforcing NOT NULL.
ALTER TABLE "AccountSnapshot" ADD COLUMN "updatedAt" TIMESTAMP(3);
UPDATE "AccountSnapshot" SET "updatedAt" = "createdAt" WHERE "updatedAt" IS NULL;
ALTER TABLE "AccountSnapshot" ALTER COLUMN "updatedAt" SET NOT NULL;
