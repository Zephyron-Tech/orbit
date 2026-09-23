-- AlterTable
ALTER TABLE "SentNotification" ADD COLUMN     "body" TEXT NOT NULL DEFAULT '',
ADD COLUMN     "data" JSONB,
ADD COLUMN     "readAt" TIMESTAMP(3),
ADD COLUMN     "title" TEXT NOT NULL DEFAULT '';

-- CreateIndex
CREATE INDEX "SentNotification_userId_sentAt_idx" ON "SentNotification"("userId", "sentAt");
