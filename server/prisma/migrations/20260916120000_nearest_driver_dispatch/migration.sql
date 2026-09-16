ALTER TABLE "DriverProfile" ADD COLUMN "locationLatitude" DOUBLE PRECISION;
ALTER TABLE "DriverProfile" ADD COLUMN "locationLongitude" DOUBLE PRECISION;
ALTER TABLE "DriverProfile" ADD COLUMN "locationAccuracyM" DOUBLE PRECISION;
ALTER TABLE "DriverProfile" ADD COLUMN "locationMeasuredAt" TIMESTAMP(3);
ALTER TABLE "OrderOffer" ADD COLUMN "expiresAt" TIMESTAMP(3);
UPDATE "OrderOffer" SET "expiresAt" = LEAST("createdAt" + INTERVAL '30 seconds', (SELECT "searchExpiresAt" FROM "Order" WHERE "Order"."id" = "OrderOffer"."orderId"));
ALTER TABLE "OrderOffer" ALTER COLUMN "expiresAt" SET NOT NULL;
CREATE INDEX "OrderOffer_orderId_skipped_expiresAt_idx" ON "OrderOffer"("orderId", "skipped", "expiresAt");
