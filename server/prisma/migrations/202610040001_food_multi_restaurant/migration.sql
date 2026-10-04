-- A single atomic checkout can now contain one active order per restaurant.
-- Submission/retry serialization remains under the existing client row lock.
DROP INDEX "FoodOrder_one_active_client";
CREATE UNIQUE INDEX "FoodOrder_one_active_client_restaurant" ON "FoodOrder"("clientId", "restaurantId")
WHERE "status" IN ('PLACED','CONFIRMED','PREPARING','READY','DELIVERING');
