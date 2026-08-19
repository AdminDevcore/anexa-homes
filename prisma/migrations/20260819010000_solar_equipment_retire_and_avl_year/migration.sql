-- AVL year on the solar catalogue.
--
-- Solar only (solar_equipment). Additive and reversible: one nullable column,
-- rollback is DROP COLUMN. Roofing does not read this table.
--
-- Retirement itself needs no migration — `isActive` already exists and the
-- design save already refuses to attach a retired item to a NEW design while
-- letting an existing one keep rendering. What was missing was a way to SET it,
-- which is UI, not schema.
ALTER TABLE "solar_equipment"
  ADD COLUMN IF NOT EXISTS "avlYear" INTEGER;

-- The approved-vendor list turns over by year, and the catalogue has to say
-- which year a product belongs to so a 2025 item is recognisable after the 2026
-- list lands. Nullable because plenty of items are not year-scoped at all.
COMMENT ON COLUMN "solar_equipment"."avlYear" IS
  'Approved-vendor-list year this item belongs to, e.g. 2026. Null = not year-scoped.';
