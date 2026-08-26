-- Restore the crossover columns (empty — the data never existed).
ALTER TABLE "leads"
  ADD COLUMN IF NOT EXISTS "needsReroof" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "needsMpu" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "linkedDealId" TEXT;
ALTER TABLE "leads" ADD CONSTRAINT "leads_linkedDealId_fkey"
  FOREIGN KEY ("linkedDealId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "solar_equipment" ADD COLUMN IF NOT EXISTS "crossoverKind" TEXT;
