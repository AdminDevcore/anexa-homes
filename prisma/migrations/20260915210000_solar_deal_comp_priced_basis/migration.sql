-- Pricing rework, Stage 1 (revised): record WHERE a frozen commission measure
-- came from.
--
-- The measure is taken from the SIGNED PROPOSAL — the document the customer
-- agreed to. "live_deal" marks the fallback used when that document carries no
-- priced figures (a version generated before the snapshot recorded them, or a
-- lease or PPA, which has no system price).
--
-- Additive: one nullable column, no existing row changes.

-- AlterTable
ALTER TABLE "solar_deal_comp" ADD COLUMN     "pricedBasis" TEXT;
