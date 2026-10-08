CREATE TABLE "ServiceCity" (
  "id" UUID NOT NULL,
  "name" TEXT NOT NULL,
  "aliases" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "status" TEXT NOT NULL DEFAULT 'SOON',
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ServiceCity_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ServiceCity_status_check" CHECK ("status" IN ('ACTIVE', 'SOON', 'HIDDEN'))
);
CREATE UNIQUE INDEX "ServiceCity_name_key" ON "ServiceCity"("name");
CREATE UNIQUE INDEX "ServiceCity_normalized_name_key" ON "ServiceCity"(lower("name"));
INSERT INTO "ServiceCity" ("id", "name", "status", "sortOrder", "updatedAt") VALUES
('841ed56a-4aa1-4417-8a44-c98cc12a2001', 'Шамалды-Сай', 'ACTIVE', 0, CURRENT_TIMESTAMP),
('841ed56a-4aa1-4417-8a44-c98cc12a2002', 'Кочкор-Ата', 'SOON', 1, CURRENT_TIMESTAMP),
('841ed56a-4aa1-4417-8a44-c98cc12a2003', 'Кербен', 'SOON', 2, CURRENT_TIMESTAMP);
