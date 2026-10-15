-- Preserve existing UUIDs, foreign keys and history. A phone can identify one
-- account in each app; existing accounts keep their current role and ID.
BEGIN;
DROP INDEX "User_phone_key";
CREATE UNIQUE INDEX "User_phone_role_key" ON "User"("phone", "role");
ALTER TABLE "User" ADD COLUMN "firstName" TEXT NOT NULL DEFAULT '',
                   ADD COLUMN "lastName" TEXT NOT NULL DEFAULT '';

-- Existing mobile builds requested client challenges. Bind all future OTPs to
-- the selected application without changing phone-level throttling.
ALTER TABLE "SmsChallenge" ADD COLUMN "role" "Role" NOT NULL DEFAULT 'CLIENT';
COMMIT;
