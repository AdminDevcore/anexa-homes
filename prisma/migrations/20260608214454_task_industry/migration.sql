-- Ensure the Industry enum exists before first use. The CREATE TYPE for this
-- enum lives in a later migration (20260609015435_industries), so create it
-- here idempotently to keep a fresh migrate/replay in order. No-op if present.
DO $$ BEGIN
  CREATE TYPE "Industry" AS ENUM ('roofing', 'solar', 'water');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- Per-industry isolation for tasks (idempotent: safe if added concurrently).
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "industry" "Industry" NOT NULL DEFAULT 'roofing';
CREATE INDEX IF NOT EXISTS "tasks_companyId_industry_idx" ON "tasks"("companyId", "industry");
