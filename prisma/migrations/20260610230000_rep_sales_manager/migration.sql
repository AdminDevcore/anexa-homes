-- Sales reps report to a sales manager: the manager sees only their team's work.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "managerId" TEXT;

DO $$ BEGIN
  ALTER TABLE "users"
    ADD CONSTRAINT "users_managerId_fkey"
    FOREIGN KEY ("managerId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "users_companyId_managerId_idx" ON "users"("companyId", "managerId");
