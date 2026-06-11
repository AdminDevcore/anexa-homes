-- Track when a lead last entered its current pipeline stage (drives the
-- "days in this status" age badge on pipeline cards). Idempotent so it is safe
-- on databases where the column was already applied via `prisma db push`.
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "stageChangedAt" TIMESTAMP(3);
