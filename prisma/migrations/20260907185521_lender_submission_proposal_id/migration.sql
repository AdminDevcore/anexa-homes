-- Which frozen proposal each lender submission spoke for.
--
-- Nullable and left null for history: an attempt recorded before this column
-- existed cannot be attributed to a version after the fact, and guessing
-- ("probably the newest at the time") would put a price against a document
-- nobody actually sent. Null reads as "this deal was submitted, but not
-- attributably to one version", which is true.
ALTER TABLE "solar_lender_submissions" ADD COLUMN     "proposalId" TEXT;

-- CreateIndex
CREATE INDEX "solar_lender_submissions_companyId_proposalId_idx" ON "solar_lender_submissions"("companyId", "proposalId");
