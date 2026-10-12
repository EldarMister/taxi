CREATE OR REPLACE FUNCTION atlas_offer_event_outbox() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO "OrderEventOutbox"("aggregateType","aggregateId","previousDriverId") VALUES ('TAXI',NEW."orderId",NEW."driverId");
  RETURN NEW;
END $$;
CREATE TRIGGER atlas_offer_insert AFTER INSERT ON "OrderOffer" FOR EACH ROW EXECUTE FUNCTION atlas_offer_event_outbox();
CREATE TRIGGER atlas_offer_change AFTER UPDATE OF skipped,"expiresAt" ON "OrderOffer" FOR EACH ROW
WHEN (ROW(OLD.skipped,OLD."expiresAt") IS DISTINCT FROM ROW(NEW.skipped,NEW."expiresAt")) EXECUTE FUNCTION atlas_offer_event_outbox();
