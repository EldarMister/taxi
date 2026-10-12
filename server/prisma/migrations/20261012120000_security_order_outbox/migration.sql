CREATE TABLE "OrderEventOutbox" (
  "id" UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  "aggregateType" TEXT NOT NULL CHECK ("aggregateType" IN ('TAXI','FOOD')),
  "aggregateId" UUID NOT NULL,
  "previousDriverId" UUID,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "availableAt" TIMESTAMP(3) NOT NULL DEFAULT (CURRENT_TIMESTAMP AT TIME ZONE 'UTC'),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "deliveredAt" TIMESTAMP(3)
);
CREATE INDEX "OrderEventOutbox_deliveredAt_availableAt_createdAt_idx" ON "OrderEventOutbox"("deliveredAt","availableAt","createdAt");
CREATE INDEX "FoodOrder_restaurantId_createdAt_idx" ON "FoodOrder"("restaurantId","createdAt");
CREATE INDEX "RestaurantSession_expiresAt_idx" ON "RestaurantSession"("expiresAt");
CREATE OR REPLACE FUNCTION atlas_order_event_outbox() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "OrderEventOutbox"("aggregateType","aggregateId","previousDriverId")
  VALUES ('TAXI', NEW.id, CASE WHEN TG_OP = 'UPDATE' THEN OLD."driverId" ELSE NULL END);
  RETURN NEW;
END $$;
CREATE TRIGGER atlas_taxi_order_insert AFTER INSERT ON "Order" FOR EACH ROW EXECUTE FUNCTION atlas_order_event_outbox();
CREATE TRIGGER atlas_taxi_order_change AFTER UPDATE OF status,price,"driverId" ON "Order"
FOR EACH ROW WHEN (ROW(OLD.status,OLD.price,OLD."driverId") IS DISTINCT FROM ROW(NEW.status,NEW.price,NEW."driverId")) EXECUTE FUNCTION atlas_order_event_outbox();
CREATE OR REPLACE FUNCTION atlas_food_event_outbox() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "OrderEventOutbox"("aggregateType","aggregateId") VALUES ('FOOD', NEW.id);
  RETURN NEW;
END $$;
CREATE TRIGGER atlas_food_order_insert AFTER INSERT ON "FoodOrder" FOR EACH ROW EXECUTE FUNCTION atlas_food_event_outbox();
CREATE TRIGGER atlas_food_order_change AFTER UPDATE OF status,"deliveryMethod","courierName","courierPhone" ON "FoodOrder"
FOR EACH ROW WHEN (ROW(OLD.status,OLD."deliveryMethod",OLD."courierName",OLD."courierPhone") IS DISTINCT FROM ROW(NEW.status,NEW."deliveryMethod",NEW."courierName",NEW."courierPhone")) EXECUTE FUNCTION atlas_food_event_outbox();
