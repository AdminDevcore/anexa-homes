-- Drop the Solar → Roofing crossover.
--
-- The feature was never finished: the columns, two server actions and a tag in
-- the adder catalogue existed, but nothing in the app ever wrote them. Every
-- row is at its default (verified: 0 flagged, 0 linked, 0 tagged), so this
-- drops storage, not data.
ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_linkedDealId_fkey";
ALTER TABLE "leads"
  DROP COLUMN IF EXISTS "needsReroof",
  DROP COLUMN IF EXISTS "needsMpu",
  DROP COLUMN IF EXISTS "linkedDealId";

ALTER TABLE "solar_equipment" DROP COLUMN IF EXISTS "crossoverKind";
