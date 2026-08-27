-- An adder that rides ON TOP of a partner's fixed or maximum final $/W.
--
-- Amos Capital Fund sells a flat $5.50/W, fee and adders included — except a
-- roof, which is added to the loan at what the roof costs. A 10 kW job is
-- $55,000; the same job with a $7,000 roof under it is $62,000. Every other
-- adder still comes out of that ceiling, so the exception belongs to the ADDER
-- and not to the lender.
--
-- Every column defaults to the behaviour that exists today, so nothing is
-- re-priced by this migration: no adder is flagged until somebody ticks the box
-- in Settings, and until one is, `onTopAdderTotalCents` stays zero on every row.
ALTER TABLE "solar_equipment" ADD COLUMN "financedOnTop" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "solar_deal_adders" ADD COLUMN "financedOnTop" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "solar_finance" ADD COLUMN "onTopAdderTotalCents" INTEGER NOT NULL DEFAULT 0;
