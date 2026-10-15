-- Account deletion removes shared orders and all their personal details. The
-- other driver's own signed amounts remain in the ledger without that order.
ALTER TABLE "LedgerEntry" DROP CONSTRAINT "Ledger_valid_amount";
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "Ledger_valid_amount" CHECK (
  ("kind" = 'TOPUP' AND "amount" > 0 AND "orderId" IS NULL)
  OR
  ("kind" = 'COMMISSION' AND "amount" <= 0 AND (
    "orderId" IS NOT NULL
    OR ("actorId" IS NULL AND "idempotencyKey" = 'anonymous:' || "id"::text
        AND "note" = 'Операция без персональных данных')
  ))
);
