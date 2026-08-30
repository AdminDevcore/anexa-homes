-- The federal credits the "what you actually pay" page is worked out from.
-- Additive only: every default is the statute as it stands, so an existing row
-- reads exactly as a new one. Nothing quotes these unless the deal's lender
-- carries a contract adjustment.
ALTER TABLE "solar_settings"
  ADD COLUMN IF NOT EXISTS "creditItcPct" DOUBLE PRECISION NOT NULL DEFAULT 30,
  ADD COLUMN IF NOT EXISTS "creditEnergyCommunityPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "creditDomesticContentPct" DOUBLE PRECISION NOT NULL DEFAULT 10,
  ADD COLUMN IF NOT EXISTS "creditIncentiveLabel" TEXT NOT NULL DEFAULT 'Incentive for signing today',
  ADD COLUMN IF NOT EXISTS "creditDisclaimer" TEXT NOT NULL DEFAULT 'Tax credits are claimed on your own federal return and depend on your tax liability and on your eligibility for each credit shown. They are not a discount applied by us and they are not a guarantee. We are not tax advisers — please confirm with your tax professional.';

-- Which credits THIS job earns. True is the ordinary case; the two bonuses are
-- unticked by a rep on a job that does not qualify.
ALTER TABLE "solar_finance"
  ADD COLUMN IF NOT EXISTS "claimItc" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "claimEnergyCommunity" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "claimDomesticContent" BOOLEAN NOT NULL DEFAULT true;
