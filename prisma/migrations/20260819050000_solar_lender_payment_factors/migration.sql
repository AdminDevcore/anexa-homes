-- Payment factors on a lender product, and the credit routing a lender needs
-- to be usable at the close.
--
-- Strictly additive and solar-only: seven new nullable columns across two
-- existing solar tables. No column changes type, loses a constraint or is
-- rewritten, so this is safe on a live database and reversible by dropping
-- what it adds.

-- ── Lender: how credit actually gets run with this partner ─────────────────
-- Two link columns, never one. `portalUrl` is your dealer login and stays
-- inside the CRM; `applyUrl` is the only one a customer-facing proposal ever
-- renders. One shared field is how a back-office login reaches a homeowner.
ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "portalUrl" TEXT;
ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "applyUrl" TEXT;
ALTER TABLE "solar_lenders" ADD COLUMN IF NOT EXISTS "creditInstructions" TEXT;

-- ── Product: the rate sheet's own payment arithmetic ───────────────────────
-- Factors in millionths: 5712 = 0.005712 per dollar financed.
ALTER TABLE "solar_lender_products" ADD COLUMN IF NOT EXISTS "factorWithPaydownMicros" INTEGER;
ALTER TABLE "solar_lender_products" ADD COLUMN IF NOT EXISTS "factorWithoutPaydownMicros" INTEGER;
ALTER TABLE "solar_lender_products" ADD COLUMN IF NOT EXISTS "paydownPct" DOUBLE PRECISION;
ALTER TABLE "solar_lender_products" ADD COLUMN IF NOT EXISTS "paydownMonths" INTEGER;
