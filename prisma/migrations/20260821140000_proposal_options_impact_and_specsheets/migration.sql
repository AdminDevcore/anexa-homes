-- The three columns the Pipe-parity proposal needs.
--
-- All three are additive with defaults, so every existing row is already
-- correct the moment the column exists: a company that has never set a
-- home-value figure makes no such claim (0 omits the card), every proposal
-- generated before the payment switcher keeps offering exactly what it was
-- quoted on (true is a no-op while a snapshot carries one option), and a
-- catalogue item with no datasheet renders no link.

-- What an owned system is claimed to add to a home's value, %. Default 0 =
-- the claim is not made; see the schema comment.
ALTER TABLE "solar_settings"
  ADD COLUMN "homeValueUpliftPct" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- Whether the customer's copy offers the payment menu.
ALTER TABLE "solar_proposals"
  ADD COLUMN "showPaymentOptions" BOOLEAN NOT NULL DEFAULT true;

-- The manufacturer's own datasheet, as a link.
ALTER TABLE "solar_equipment"
  ADD COLUMN "specSheetUrl" TEXT;
