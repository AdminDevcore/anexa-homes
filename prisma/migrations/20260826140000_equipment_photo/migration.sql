-- A photograph of a catalogue component, shown to the customer on the proposal
-- beside the panel, inverter or battery it depicts.
--
-- Bytes we hold, addressed by a storage key, exactly like a lender's logo:
-- the proposal is opened without a session, so the serving route is public and
-- the key is never exposed. Two nullable columns, no backfill — every existing
-- item simply has no photo and renders as it always did.
ALTER TABLE "solar_equipment" ADD COLUMN "photoKey" TEXT;
ALTER TABLE "solar_equipment" ADD COLUMN "photoUpdatedAt" TIMESTAMP(3);
