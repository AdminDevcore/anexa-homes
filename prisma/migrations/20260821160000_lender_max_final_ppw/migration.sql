-- The most a lender's paper ever puts in front of a homeowner, per installed
-- watt, in cents -- dealer fee and adders included. 550 = $5.50/W.
--
-- Nullable with no default on purpose: NULL means "no ceiling", which is every
-- existing lender, so this migration cannot move a single quoted price.
ALTER TABLE "solar_lenders" ADD COLUMN "maxFinalPpwCents" INTEGER;
