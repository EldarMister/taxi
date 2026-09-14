ALTER TABLE "RefreshSession" ADD COLUMN "adminAuthenticated" BOOLEAN NOT NULL DEFAULT false;
CREATE TABLE "AdminCredential" (
  "userId" UUID NOT NULL PRIMARY KEY,
  "username" TEXT NOT NULL,
  "passwordHash" TEXT NOT NULL,
  "disabled" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AdminCredential_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "AdminCredential_username_key" ON "AdminCredential"("username");
CREATE TABLE "AdminAudit" (
  "id" UUID NOT NULL PRIMARY KEY,
  "actorId" UUID NOT NULL,
  "action" TEXT NOT NULL,
  "entity" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "details" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "AdminAudit_createdAt_idx" ON "AdminAudit"("createdAt");
CREATE INDEX "AdminAudit_entity_entityId_idx" ON "AdminAudit"("entity", "entityId");
CREATE TABLE "Banner" (
  "id" UUID NOT NULL PRIMARY KEY,
  "title" TEXT NOT NULL,
  "subtitle" TEXT NOT NULL DEFAULT '',
  "imageUrl" TEXT,
  "imageKey" TEXT,
  "actionType" TEXT NOT NULL DEFAULT 'NONE',
  "restaurantId" TEXT,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE INDEX "Banner_active_sortOrder_idx" ON "Banner"("active", "sortOrder");
CREATE TABLE "MediaAsset" (
  "id" UUID NOT NULL PRIMARY KEY,
  "data" BYTEA NOT NULL,
  "mime" TEXT NOT NULL,
  "width" INTEGER NOT NULL,
  "height" INTEGER NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
