-- How the sign today credit is arrived at, partner by partner.
--
-- The credit is display-only either way -- it comes off what the household
-- nets, never off the price, and the partner funds the same contract -- but
-- what we may hand back differs by partner. Three answers:
--
--   none       the rep types it, which is what every lender did until now
--   fixed      this partner gives a figure, automatic on all its deals
--   above_cap  whatever the SYSTEM is priced above a per-watt cap, derived
--
-- `above_cap` is measured on the system price (the array at sticker, fee
-- included, adders and battery excluded): those two are work and hardware the
-- household is charged for, not margin anybody can give away, and a cap read
-- against the whole contract would turn a $120,000 battery into a $120,000
-- discount.
--
-- Defaults to `none` with both figures null, so every existing lender keeps
-- behaving exactly as it does today and no deal reprices.
CREATE TYPE "SolarSignTodayMode" AS ENUM ('none', 'fixed', 'above_cap');

ALTER TABLE "solar_lenders"
  ADD COLUMN "signTodayMode" "SolarSignTodayMode" NOT NULL DEFAULT 'none',
  ADD COLUMN "signTodayFixedCents" INTEGER,
  ADD COLUMN "signTodayCapPpwCents" INTEGER;
