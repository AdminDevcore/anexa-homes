-- Which version of a solar proposal this deal actually sold.
--
-- Nullable throughout, so every proposal that already exists keeps its current
-- meaning: nothing is retroactively "the final one", because nobody has said
-- so yet.
ALTER TABLE "solar_proposals"
  ADD COLUMN "approvedAt"     TIMESTAMP(3),
  ADD COLUMN "approvedById"   TEXT,
  ADD COLUMN "approvedFileId" TEXT;

-- "Exactly one approved version per deal", enforced by Postgres rather than by
-- whichever code path happens to run.
--
-- PARTIAL, and it has to be: a plain UNIQUE on (leadId) would allow one
-- proposal per deal in total, and the whole feature is about picking one out of
-- ten. Prisma's schema language cannot express the WHERE clause, which is why
-- this index is written here by hand and carries no @@unique counterpart.
CREATE UNIQUE INDEX "solar_proposals_one_approved_per_lead"
  ON "solar_proposals" ("leadId")
  WHERE "approvedAt" IS NOT NULL;

-- Reading "is anything approved on this deal" happens on every deal page and
-- every proposal builder load.
CREATE INDEX "solar_proposals_leadId_approvedAt_idx"
  ON "solar_proposals" ("leadId", "approvedAt");
