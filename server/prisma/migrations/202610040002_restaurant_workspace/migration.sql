CREATE TABLE "RestaurantAccount" (
 "id" UUID PRIMARY KEY, "phone" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT '', "passwordHash" TEXT NOT NULL,
 "active" BOOLEAN NOT NULL DEFAULT true, "sessionVersion" INTEGER NOT NULL DEFAULT 0,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "RestaurantAccount_phone_key" ON "RestaurantAccount"("phone");
CREATE TABLE "RestaurantMembership" (
 "id" UUID PRIMARY KEY, "accountId" UUID NOT NULL REFERENCES "RestaurantAccount"("id") ON DELETE CASCADE,
 "restaurantId" TEXT NOT NULL REFERENCES "FoodRestaurant"("id"), "role" TEXT NOT NULL CHECK ("role" IN ('OWNER','MANAGER')),
 "permissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[], "active" BOOLEAN NOT NULL DEFAULT true,
 "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "RestaurantMembership_accountId_restaurantId_key" ON "RestaurantMembership"("accountId","restaurantId");
CREATE INDEX "RestaurantMembership_restaurantId_active_idx" ON "RestaurantMembership"("restaurantId","active");
CREATE TABLE "RestaurantSession" (
 "id" UUID PRIMARY KEY, "accountId" UUID NOT NULL REFERENCES "RestaurantAccount"("id") ON DELETE CASCADE,
 "tokenHash" TEXT NOT NULL, "familyId" UUID NOT NULL, "sessionVersion" INTEGER NOT NULL,
 "expiresAt" TIMESTAMP(3) NOT NULL, "revokedAt" TIMESTAMP(3), "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "RestaurantSession_tokenHash_key" ON "RestaurantSession"("tokenHash");
CREATE INDEX "RestaurantSession_accountId_revokedAt_idx" ON "RestaurantSession"("accountId","revokedAt");
CREATE INDEX "RestaurantSession_familyId_idx" ON "RestaurantSession"("familyId");
ALTER TABLE "FoodOrder" ADD COLUMN "deliveryPoint" JSONB, ADD COLUMN "deliveryMethod" TEXT,
 ADD COLUMN "courierName" TEXT, ADD COLUMN "courierPhone" TEXT;
ALTER TABLE "Order" ADD COLUMN "foodOrderId" UUID REFERENCES "FoodOrder"("id");
CREATE UNIQUE INDEX "Order_foodOrderId_key" ON "Order"("foodOrderId");
-- Several restaurant deliveries may run alongside a customer's taxi ride.
DROP INDEX "Order_one_active_client";
CREATE UNIQUE INDEX "Order_one_active_client" ON "Order"("clientId")
 WHERE "status" IN ('SEARCHING','ASSIGNED','ARRIVED','IN_PROGRESS') AND "foodOrderId" IS NULL;
