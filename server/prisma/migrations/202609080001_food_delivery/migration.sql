CREATE TYPE "FoodOrderStatus" AS ENUM ('PLACED','CONFIRMED','PREPARING','READY','DELIVERING','COMPLETED','CANCELLED');
CREATE TYPE "FoodFulfillment" AS ENUM ('DELIVERY','PICKUP');
CREATE TYPE "FoodPaymentMethod" AS ENUM ('CASH','CARD','ONLINE');

CREATE TABLE "FoodRestaurant" (
  "id" TEXT NOT NULL,
  "catalog" JSONB NOT NULL,
  "active" BOOLEAN NOT NULL DEFAULT false,
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "FoodRestaurant_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "FoodOrder" (
  "id" UUID NOT NULL,
  "clientId" UUID NOT NULL,
  "restaurantId" TEXT NOT NULL,
  "restaurantSnapshot" JSONB NOT NULL,
  "requestId" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "items" JSONB NOT NULL,
  "subtotal" INTEGER NOT NULL,
  "deliveryFee" INTEGER NOT NULL,
  "total" INTEGER NOT NULL,
  "fulfillment" "FoodFulfillment" NOT NULL,
  "address" TEXT NOT NULL,
  "comment" TEXT NOT NULL DEFAULT '',
  "paymentMethod" "FoodPaymentMethod" NOT NULL,
  "status" "FoodOrderStatus" NOT NULL DEFAULT 'PLACED',
  "isDemo" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "FoodOrder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "FoodOrder_valid_total" CHECK ("subtotal" >= 0 AND "deliveryFee" >= 0 AND "total" = "subtotal" + "deliveryFee" AND "total" <= 1000000),
  CONSTRAINT "FoodOrder_valid_fulfillment" CHECK (("fulfillment" = 'DELIVERY' AND char_length(trim("address")) >= 5) OR ("fulfillment" = 'PICKUP' AND "deliveryFee" = 0)),
  CONSTRAINT "FoodOrder_pickup_status" CHECK ("fulfillment" <> 'PICKUP' OR "status" <> 'DELIVERING')
);
CREATE TABLE "FoodStatusHistory" (
  "id" UUID NOT NULL,
  "orderId" UUID NOT NULL,
  "status" "FoodOrderStatus" NOT NULL,
  "actorId" UUID NOT NULL,
  "reason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodStatusHistory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "FoodOrder_clientId_requestId_key" ON "FoodOrder"("clientId","requestId");
CREATE INDEX "FoodOrder_clientId_createdAt_idx" ON "FoodOrder"("clientId","createdAt");
CREATE INDEX "FoodOrder_status_createdAt_idx" ON "FoodOrder"("status","createdAt");
CREATE INDEX "FoodStatusHistory_orderId_createdAt_idx" ON "FoodStatusHistory"("orderId","createdAt");
CREATE UNIQUE INDEX "FoodOrder_one_active_client" ON "FoodOrder"("clientId") WHERE "status" IN ('PLACED','CONFIRMED','PREPARING','READY','DELIVERING');
ALTER TABLE "FoodOrder" ADD CONSTRAINT "FoodOrder_clientId_fkey" FOREIGN KEY ("clientId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodOrder" ADD CONSTRAINT "FoodOrder_restaurantId_fkey" FOREIGN KEY ("restaurantId") REFERENCES "FoodRestaurant"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FoodStatusHistory" ADD CONSTRAINT "FoodStatusHistory_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "FoodOrder"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
