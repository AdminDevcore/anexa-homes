-- The homeowner's preferred language, and the two loan figures the deal page
-- had no column for. All three are additive and NULLABLE with no default:
-- every existing row reads NULL, nothing is backfilled, and no rendered output
-- changes anywhere until someone enters a value.
--
-- `preferredLanguage` sits on the shared Lead, not a solar table — a roofing
-- customer has a preferred language too.
ALTER TABLE "leads" ADD COLUMN "preferredLanguage" TEXT;

-- `loanMonthlyPaymentCents` is deliberately its own column rather than a reuse
-- of `monthlyPaymentCents`, which is LEASE-only: overloading it would make a
-- lease payment and a loan payment indistinguishable at the database level.
ALTER TABLE "solar_finance"
  ADD COLUMN "downPaymentCents" INTEGER,
  ADD COLUMN "loanMonthlyPaymentCents" INTEGER;
