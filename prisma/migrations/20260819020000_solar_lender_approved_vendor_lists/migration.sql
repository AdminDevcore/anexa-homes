-- Lender approved-vendor lists for the solar catalogue.
--
-- Solar only. Two new tables plus one nullable column on solar_designs.
-- Additive throughout: nothing existing is altered or dropped, and a rollback
-- is DROP TABLE / DROP COLUMN. Roofing reads none of this.

-- A finance partner whose AVL constrains what can be sold. Managed data rather
-- than free text, because "Credit Human", "credit human" and "CreditHuman"
-- cannot be used to filter a catalogue.
CREATE TABLE IF NOT EXISTS "solar_lenders" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "vertical"  "Industry" NOT NULL DEFAULT 'solar',
  "name"      TEXT NOT NULL,
  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "rank"      INTEGER NOT NULL DEFAULT 0,
  "notes"     TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solar_lenders_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "solar_lenders"
  ADD CONSTRAINT "solar_lenders_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "solar_lenders_companyId_isActive_idx"
  ON "solar_lenders" ("companyId", "isActive");

-- One lender per name per company, case-insensitively. Two "Credit Human" rows
-- would split one AVL across two lenders and quietly hide approved equipment.
CREATE UNIQUE INDEX IF NOT EXISTS "solar_lenders_company_name_key"
  ON "solar_lenders" ("companyId", lower("name"));

-- Which lenders approve which equipment. Many-to-many: a panel is commonly on
-- several AVLs, and a lender's list runs to dozens of items.
CREATE TABLE IF NOT EXISTS "solar_equipment_lenders" (
  "equipmentId" TEXT NOT NULL,
  "lenderId"    TEXT NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "solar_equipment_lenders_pkey" PRIMARY KEY ("equipmentId", "lenderId")
);

ALTER TABLE "solar_equipment_lenders"
  ADD CONSTRAINT "solar_equipment_lenders_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "solar_equipment"("id") ON UPDATE CASCADE ON DELETE CASCADE;

ALTER TABLE "solar_equipment_lenders"
  ADD CONSTRAINT "solar_equipment_lenders_lenderId_fkey"
  FOREIGN KEY ("lenderId") REFERENCES "solar_lenders"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "solar_equipment_lenders_lenderId_idx"
  ON "solar_equipment_lenders" ("lenderId");

-- The lender a given system is being designed for. ON DELETE SET NULL rather
-- than CASCADE: removing a lender must never delete a customer's design.
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "lenderId" TEXT;

ALTER TABLE "solar_designs"
  ADD CONSTRAINT "solar_designs_lenderId_fkey"
  FOREIGN KEY ("lenderId") REFERENCES "solar_lenders"("id") ON UPDATE CASCADE ON DELETE SET NULL;
