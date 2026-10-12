ALTER TABLE "SmsChallenge"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'local',
ADD COLUMN "providerTokenCiphertext" TEXT;
