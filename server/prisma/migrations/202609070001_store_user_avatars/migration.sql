ALTER TABLE "User"
ADD COLUMN "avatarData" BYTEA,
ADD COLUMN "avatarMime" TEXT,
ADD COLUMN "avatarUpdatedAt" TIMESTAMP(3);

ALTER TABLE "User"
ADD CONSTRAINT "User_avatar_consistency_check" CHECK (
  ("avatarData" IS NULL AND "avatarMime" IS NULL AND "avatarUpdatedAt" IS NULL)
  OR
  (
    "avatarData" IS NOT NULL
    AND "avatarMime" IN ('image/jpeg', 'image/png', 'image/webp')
    AND "avatarUpdatedAt" IS NOT NULL
    AND octet_length("avatarData") BETWEEN 1 AND 5242880
  )
);
