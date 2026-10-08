CREATE TABLE "OtpDeliveryAttempt" (
  "id" UUID NOT NULL,
  "phone" TEXT NOT NULL,
  "codeHash" TEXT NOT NULL,
  "codeCiphertext" TEXT NOT NULL,
  "channel" TEXT NOT NULL DEFAULT 'whatsapp',
  "state" TEXT NOT NULL DEFAULT 'sending_whatsapp',
  "whatsappMessageId" TEXT,
  "telegramRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "nextCheckAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "OtpDeliveryAttempt_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OtpDeliveryAttempt_state_nextCheckAt_idx" ON "OtpDeliveryAttempt"("state", "nextCheckAt");
CREATE INDEX "OtpDeliveryAttempt_expiresAt_idx" ON "OtpDeliveryAttempt"("expiresAt");
