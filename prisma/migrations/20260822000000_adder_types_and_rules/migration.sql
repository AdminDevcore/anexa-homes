-- An adder stops being "a price" and becomes a priced RULE.
--
-- Three new bases (per unit, per foot, discount), the words a homeowner reads,
-- the system-size band that puts one on a deal by itself, and the kWh an EV
-- charger adds to the house it is sold to. Every column is additive with a
-- default, so nothing that is already quoted moves by a cent.

-- ── Bases ────────────────────────────────────────────────────────────────────
ALTER TYPE "SolarAdderBasis" ADD VALUE IF NOT EXISTS 'perUnit';
ALTER TYPE "SolarAdderBasis" ADD VALUE IF NOT EXISTS 'perFoot';
ALTER TYPE "SolarAdderBasis" ADD VALUE IF NOT EXISTS 'discount';

-- ── Catalogue ────────────────────────────────────────────────────────────────
ALTER TABLE "solar_equipment"
  ADD COLUMN IF NOT EXISTS "adderBasis"            "SolarAdderBasis",
  ADD COLUMN IF NOT EXISTS "description"           TEXT,
  ADD COLUMN IF NOT EXISTS "isVeryCommon"          BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "showOnProposal"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "autoApplyMinKw"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "autoApplyMaxKw"        DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "consumptionAdjustable" BOOLEAN NOT NULL DEFAULT false;

-- ── Deal lines ───────────────────────────────────────────────────────────────
ALTER TABLE "solar_deal_adders"
  ADD COLUMN IF NOT EXISTS "description"           TEXT,
  ADD COLUMN IF NOT EXISTS "showOnProposal"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "consumptionKwhPerYear" INTEGER,
  ADD COLUMN IF NOT EXISTS "autoApplied"           BOOLEAN NOT NULL DEFAULT false;

-- ── Design ───────────────────────────────────────────────────────────────────
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "usageAdjustmentKwh" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "autoAdderOptOut"    JSONB   NOT NULL DEFAULT '[]';

-- ── Backfill the basis every existing adder was already being priced on ──────
-- The rule the code used before this column existed, written down once: a
-- per-watt rate makes it per-watt, everything else is a flat amount. Only
-- values that already existed in the enum are used here, so this is safe to run
-- in the same transaction that added the new ones.
UPDATE "solar_equipment"
   SET "adderBasis" = CASE
         WHEN "priceMillsPerWatt" IS NOT NULL THEN 'perWatt'::"SolarAdderBasis"
         ELSE 'flat'::"SolarAdderBasis"
       END
 WHERE "kind" = 'adder' AND "adderBasis" IS NULL;
