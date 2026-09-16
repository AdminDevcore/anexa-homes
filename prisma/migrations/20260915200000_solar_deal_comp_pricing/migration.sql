-- Pricing rework, Stage 1: freeze what a solar commission is measured on at
-- signing — the watts, the base price and the battery count — beside the rates
-- solar_deal_comp already freezes.
-- Additive only: seven nullable columns, no existing row changes. Rows frozen
-- before this migration stay NULL, which payroll reads as "use the live deal"
-- exactly as it does today, until scripts/backfill-deal-comp-pricing.ts --apply
-- is run.

-- AlterTable
ALTER TABLE "solar_deal_comp" ADD COLUMN     "systemWatts" INTEGER,
ADD COLUMN     "basePriceCents" INTEGER,
ADD COLUMN     "batteryQty" INTEGER,
ADD COLUMN     "pricedAt" TIMESTAMP(3),
ADD COLUMN     "pricedFrom" TEXT,
ADD COLUMN     "pricedProposalId" TEXT,
ADD COLUMN     "pricingMatchesSignedDocument" BOOLEAN;
