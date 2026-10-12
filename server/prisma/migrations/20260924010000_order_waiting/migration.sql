ALTER TABLE "Tariff"
  ADD COLUMN "waitingGraceMinutes" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "freeWaitingMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "waitingPricePerMinute" INTEGER NOT NULL DEFAULT 0;

-- Preserve each existing tariff's per-minute rate as the initial waiting rate.
UPDATE "Tariff" SET "waitingPricePerMinute" = "pricePerMinute";

ALTER TABLE "Order"
  ADD COLUMN "waitingGraceMinutes" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "freeWaitingMinutes" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN "waitingPricePerMinute" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "arrivedAt" TIMESTAMP(3),
  ADD COLUMN "waitingCharge" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "waitingBilledMinutes" INTEGER NOT NULL DEFAULT 0;
