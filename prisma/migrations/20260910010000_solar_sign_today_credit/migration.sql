-- The rep's own closing credit on a solar deal, in cents.
--
-- One typed rung at the bottom of the federal-credit ladder. It is not a tax
-- credit and it is not derived from the contract: it is money taken off what
-- the household NETS for signing today, entered per deal on the Financing step
-- because a company-wide figure would be the same offer to everybody.
--
-- DISPLAY ONLY. Nothing downstream reads it as price: the contract value, the
-- monthly payment, the deal's value, the rep's commission and the lender
-- submission are all untouched. What moves is the net-cost-after-credits
-- figure the proposal shows behind its tax-credit switch.
--
-- Zero on every existing row, which is the ordinary deal, so no proposal in
-- flight changes and nothing needs backfilling.
ALTER TABLE "solar_finance"
  ADD COLUMN "signTodayCreditCents" INTEGER NOT NULL DEFAULT 0;
