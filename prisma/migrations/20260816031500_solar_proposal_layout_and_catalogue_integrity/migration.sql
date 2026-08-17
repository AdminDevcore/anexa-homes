-- Solar proposal repair cycle: panel-layout attachment + equipment catalogue integrity.
--
-- Additive and reversible throughout. Every column is nullable or defaulted, so
-- existing rows are untouched and a rollback is DROP COLUMN / DROP INDEX.
-- Roofing reads none of these tables.

-- ── Phase 4: interim panel-layout image on the design ──────────────────────
-- The layout is drawn in an external tool and attached here as an image until
-- Anexa has its own roof designer. Null means "no layout yet", which the
-- proposal renders as an omitted section — never a broken image.
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "layoutImageFileId"       TEXT,
  ADD COLUMN IF NOT EXISTS "layoutImageUploadedById" TEXT,
  ADD COLUMN IF NOT EXISTS "layoutImageUploadedAt"   TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "designProvider"          TEXT,
  ADD COLUMN IF NOT EXISTS "designExternalRef"       TEXT;

-- ── Phase 2: catalogue integrity ───────────────────────────────────────────
ALTER TABLE "solar_equipment"
  ADD COLUMN IF NOT EXISTS "isDefault" BOOLEAN NOT NULL DEFAULT false;

-- Catalogue identity, enforced in the database rather than only in the action.
--
-- Functional rather than a plain @@unique because `manufacturer` and `ratingW`
-- are nullable and Postgres treats NULLs as DISTINCT — a plain unique index
-- would happily accept "(null) / Q.PEAK / 400W" twice. lower() so "Qcells" and
-- "QCELLS" are the same product, which is how they read to a rep scanning a
-- dropdown.
--
-- NOTE FOR PRODUCTION: this will fail if the catalogue already contains
-- duplicates. Check before deploying:
--   SELECT "companyId", kind, lower(coalesce(manufacturer,'')), lower(model),
--          coalesce("ratingW",-1), count(*)
--   FROM solar_equipment GROUP BY 1,2,3,4,5 HAVING count(*) > 1;
CREATE UNIQUE INDEX IF NOT EXISTS "solar_equipment_identity_key"
  ON "solar_equipment" (
    "companyId",
    "kind",
    lower(COALESCE("manufacturer", '')),
    lower("model"),
    COALESCE("ratingW", -1)
  );

-- At most ONE active default per kind per company. Partial index: deactivated
-- rows and non-defaults are exempt, so retiring a default and promoting another
-- is a normal two-step edit rather than a constraint fight.
CREATE UNIQUE INDEX IF NOT EXISTS "solar_equipment_one_default_per_kind"
  ON "solar_equipment" ("companyId", "kind")
  WHERE "isDefault" AND "isActive";
