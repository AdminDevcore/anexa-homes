-- What each partner calls the equipment WE call something else.
--
-- Additive and nullable, so every existing approval row keeps meaning exactly
-- what it meant: "this lender approves this item, and we have no separate name
-- for it." The submission payload falls back to our own manufacturer/model
-- when these are null, which is what it has always sent.
ALTER TABLE "solar_equipment_lenders"
  ADD COLUMN "lenderBrand" TEXT,
  ADD COLUMN "lenderModel" TEXT;
