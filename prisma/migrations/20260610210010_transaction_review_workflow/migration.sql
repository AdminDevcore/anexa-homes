ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "approved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "transactions" ADD COLUMN IF NOT EXISTS "autoSuggested" BOOLEAN NOT NULL DEFAULT false;
-- Existing categorized rows are considered already booked.
UPDATE "transactions" SET "approved" = true WHERE "status" = 'categorized' OR "status" = 'reconciled';
