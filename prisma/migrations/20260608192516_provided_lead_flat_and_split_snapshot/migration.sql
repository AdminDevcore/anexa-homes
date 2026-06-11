-- Provided-lead comp type (% or flat fee) + per-commission split snapshot (lock terms).
ALTER TABLE "users" ADD COLUMN "providedLeadType" TEXT NOT NULL DEFAULT 'percentage';
ALTER TABLE "users" ADD COLUMN "providedLeadFlatCents" INTEGER;
ALTER TABLE "commissions" ADD COLUMN "splitPct" DOUBLE PRECISION;
ALTER TABLE "commissions" ADD COLUMN "splitFlatCents" INTEGER NOT NULL DEFAULT 0;
