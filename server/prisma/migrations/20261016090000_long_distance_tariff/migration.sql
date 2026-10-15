ALTER TABLE "Tariff"
  ADD COLUMN "longDistanceEnabled" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "longDistanceThresholdKm" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "longDistanceBasePrice" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "longDistancePricePerKm" INTEGER NOT NULL DEFAULT 40;

ALTER TABLE "Tariff"
  ADD CONSTRAINT "Tariff_longDistanceThresholdKm_check" CHECK ("longDistanceThresholdKm" BETWEEN 1 AND 499),
  ADD CONSTRAINT "Tariff_longDistanceBasePrice_check" CHECK ("longDistanceBasePrice" BETWEEN 0 AND 1000000),
  ADD CONSTRAINT "Tariff_longDistancePricePerKm_check" CHECK ("longDistancePricePerKm" BETWEEN 0 AND 1000000);
