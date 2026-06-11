-- Second rep split for company-provided leads + a per-deal flag selecting it.
ALTER TABLE "users" ADD COLUMN "providedLeadSplitPct" DOUBLE PRECISION;
ALTER TABLE "projects" ADD COLUMN "companyProvidedLead" BOOLEAN NOT NULL DEFAULT false;
