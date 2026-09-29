ALTER TABLE "PushJob" ADD COLUMN "readAt" TIMESTAMP(3);
CREATE INDEX "PushJob_userId_readAt_createdAt_idx" ON "PushJob"("userId", "readAt", "createdAt");
