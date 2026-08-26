-- What a provider does for a solar customer: buyback, and any battery/VPP
-- programme.
--
-- The question a rep gets asked at the kitchen table and could not answer from
-- the CRM — "do they pay me for what I send back, and is there anything for the
-- battery?" — was recorded nowhere. It is a fact about the PROVIDER rather than
-- about any one deal, so it belongs on the provider list the office already
-- maintains, next to the name every proposal spells from.
--
-- Every column is optional and every default is the state of a list that has
-- never been edited: no buyback, no programme, nothing recorded. So this
-- migration changes nothing anybody sees until somebody fills it in.
--
-- The flag is separate from the rate on purpose. "They buy back, at a rate that
-- moves" and "nobody has checked yet" are different answers, and a rate of NULL
-- would collapse them into one.
--
-- `notes` is free text because a schema modelling every utility's small print —
-- term lengths, which batteries qualify, enrolment windows — would be wrong by
-- the next quarter.
ALTER TABLE "solar_providers"
  ADD COLUMN "buyback"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "buybackRateMills" INTEGER,
  ADD COLUMN "vpp"              BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "vppProgramme"     TEXT,
  ADD COLUMN "vppUpfrontCents"  INTEGER,
  ADD COLUMN "vppAnnualCents"   INTEGER,
  ADD COLUMN "notes"            TEXT;
