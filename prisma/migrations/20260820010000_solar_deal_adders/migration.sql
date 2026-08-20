-- Adders become LINES on a deal instead of one number typed into a box.
--
-- `solar_finance.adderTotalCents` stays: pricing, commissions and the
-- customer's proposal all read it, and none of them should have to sum a
-- table. It becomes a cache that the adder actions recompute, and these rows
-- become the truth behind it. Nothing is migrated INTO the table — a deal
-- carrying a typed total keeps that total and the UI offers to itemise it,
-- because inventing line items for money whose purpose nobody recorded would
-- be making up a breakdown.

-- Created only if absent, rather than dropped and recreated: a bare DROP TYPE
-- fails the moment the type is in use, which is exactly the state a partially
-- applied run of this migration leaves behind.
--
-- Scoped to `current_schema()`, and that qualification is load-bearing. This
-- project runs its e2e suite in a second SCHEMA of the same database, so an
-- unqualified `pg_type` lookup finds the type belonging to the other schema,
-- skips the create, and leaves the table below referring to a type that does
-- not exist where it is being built.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type t
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE t.typname = 'SolarAdderBasis'
      AND n.nspname = current_schema()
  ) THEN
    CREATE TYPE "SolarAdderBasis" AS ENUM ('flat', 'perWatt', 'custom');
  END IF;
END
$$;

-- Catalogue adders quoted per watt: tenths of a cent per installed watt.
-- 50 = $0.05/W. Mills, not cents, because a "5" in a cents column reads as
-- $5.00/W.
ALTER TABLE "solar_equipment"
  ADD COLUMN IF NOT EXISTS "priceMillsPerWatt" INTEGER;

CREATE TABLE IF NOT EXISTS "solar_deal_adders" (
  "id"           TEXT NOT NULL,
  "companyId"    TEXT NOT NULL,
  "vertical"     "Industry" NOT NULL DEFAULT 'solar',
  "leadId"       TEXT NOT NULL,
  "equipmentId"  TEXT,
  "label"        TEXT NOT NULL,
  "basis"        "SolarAdderBasis" NOT NULL DEFAULT 'flat',
  "flatCents"    INTEGER,
  "millsPerWatt" INTEGER,
  "qty"          INTEGER NOT NULL DEFAULT 1,
  "sortOrder"    INTEGER NOT NULL DEFAULT 0,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solar_deal_adders_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "solar_deal_adders_companyId_leadId_idx"
  ON "solar_deal_adders"("companyId", "leadId");
CREATE INDEX IF NOT EXISTS "solar_deal_adders_equipmentId_idx"
  ON "solar_deal_adders"("equipmentId");

ALTER TABLE "solar_deal_adders"
  DROP CONSTRAINT IF EXISTS "solar_deal_adders_companyId_fkey";
ALTER TABLE "solar_deal_adders"
  ADD CONSTRAINT "solar_deal_adders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_deal_adders"
  DROP CONSTRAINT IF EXISTS "solar_deal_adders_leadId_fkey";
ALTER TABLE "solar_deal_adders"
  ADD CONSTRAINT "solar_deal_adders_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- SetNull, not Cascade: retiring a catalogue item must not delete a line off a
-- quote a homeowner has already been shown.
ALTER TABLE "solar_deal_adders"
  DROP CONSTRAINT IF EXISTS "solar_deal_adders_equipmentId_fkey";
ALTER TABLE "solar_deal_adders"
  ADD CONSTRAINT "solar_deal_adders_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "solar_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
