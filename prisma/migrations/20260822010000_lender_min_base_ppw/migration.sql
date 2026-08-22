-- The least a lender's deals may leave the company, per installed watt, in
-- cents, BEFORE that lender's cut. 175 = $1.75/W.
--
-- A margin floor, and therefore on the base -- the mirror of `maxFinalPpwCents`
-- above it, which is a ceiling on the customer's contract. The two govern
-- different numbers on purpose and are named for the one each governs.
--
-- Nullable with no default: NULL means "no floor", which is every existing
-- lender, so this migration cannot block a single deal that generates today.
ALTER TABLE "solar_lenders" ADD COLUMN "minBasePpwCents" INTEGER;
