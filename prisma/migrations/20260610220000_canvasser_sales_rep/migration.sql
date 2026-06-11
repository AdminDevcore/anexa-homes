-- Canvassers report to a sales rep: their knocks/leads/appointments auto-assign
-- to (and are visible by) that rep. Self-relation on users.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "salesRepId" TEXT;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_salesRepId_fkey"
    FOREIGN KEY ("salesRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "users_companyId_salesRepId_idx" ON "users"("companyId", "salesRepId");
