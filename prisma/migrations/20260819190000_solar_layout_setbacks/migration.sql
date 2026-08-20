-- The fire setbacks traced on the roof in the panel designer.
--
-- JSON rather than a table: a setback is a polyline that only ever means
-- anything alongside the blocks in the same design, it is written and read as
-- one whole document by one screen, and nothing else ever queries across them.
-- The blocks themselves have lived in a JSON column for the same reason.
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "layoutSetbacks" JSONB NOT NULL DEFAULT '[]';
