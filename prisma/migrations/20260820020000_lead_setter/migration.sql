-- Who SET the appointment, where that is a different person from the rep who
-- runs it.
--
-- Solar sells door to door: a setter knocks and books, a closer sits the table,
-- and both are paid off the same deal. A single `assignedRepId` could name one
-- of them and lost the other. Nullable, and unused by roofing — there the
-- canvasser who knocks is already funnelled into the owning rep.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "setterId" TEXT;

CREATE INDEX IF NOT EXISTS "leads_setterId_idx" ON "leads"("setterId");

ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_setterId_fkey";
ALTER TABLE "leads"
  ADD CONSTRAINT "leads_setterId_fkey"
  FOREIGN KEY ("setterId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
