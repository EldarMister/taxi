CREATE TABLE "ClientRating" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "score" INTEGER NOT NULL,
    "comment" TEXT NOT NULL DEFAULT '',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClientRating_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ClientRating_orderId_key" ON "ClientRating"("orderId");

ALTER TABLE "ClientRating" ADD CONSTRAINT "ClientRating_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ClientRating" ADD CONSTRAINT "ClientRating_score_range" CHECK ("score" BETWEEN 1 AND 5);
