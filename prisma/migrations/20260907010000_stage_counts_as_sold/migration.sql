-- Where a pipeline books the SALE, as distinct from where the job ends.
--
-- `isWon` sits on Paid / System Activated — the end of the job — and is read by
-- the backlog and cycle-time reports. A sales leaderboard needs the earlier
-- moment: the signature. This flag marks it, and every deal at or past that
-- stage counts as won.
ALTER TABLE "pipeline_stages" ADD COLUMN "countsAsSold" BOOLEAN NOT NULL DEFAULT false;

-- Both seeded pipelines already name that moment the same way, so the flag
-- starts out where it belongs instead of on nothing at all.
UPDATE "pipeline_stages"
   SET "countsAsSold" = true
 WHERE lower(btrim("name")) IN ('contract signed', 'signed', 'sold');
