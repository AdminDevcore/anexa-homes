-- AlterTable
ALTER TABLE "bookkeeping_categories" ADD COLUMN     "excludeFromJobCost" BOOLEAN NOT NULL DEFAULT false;

-- Auto-flag existing "Contractor Sales"-style categories so sales-rep payouts are
-- excluded from deal job cost out of the box (admins can adjust per category later).
UPDATE "bookkeeping_categories" SET "excludeFromJobCost" = true
WHERE lower("name") LIKE '%contractor%sale%' OR lower("name") LIKE '%sales%payout%' OR lower("name") LIKE '%rep%commission%';
