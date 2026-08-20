-- Whether the customer's copy carries the 25-year utility-versus-solar table.
--
-- A column, deliberately outside the snapshot. The snapshot is what this
-- customer was quoted and must never move; this is a choice about what to SHOW
-- them, made at the table after the document exists — so turning the table off
-- must not reissue a version and renumber the proposal.
--
-- Defaults true, which is how every proposal already sent was rendered.
ALTER TABLE "solar_proposals"
  ADD COLUMN IF NOT EXISTS "showComparison" BOOLEAN NOT NULL DEFAULT true;
