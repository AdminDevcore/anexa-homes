-- Whether a company has DECIDED its minimum offset. Additive and default false.
--
-- A row whose minimum is already above zero was set by somebody, so it is
-- marked configured and keeps being enforced exactly as before. A zero stays
-- "not decided yet" -- warned on the deal and shown as a Settings gap, never a
-- block -- until an admin sets a minimum or confirms "no minimum".
ALTER TABLE "solar_settings" ADD COLUMN "minOffsetConfigured" BOOLEAN NOT NULL DEFAULT false;

UPDATE "solar_settings" SET "minOffsetConfigured" = true WHERE "minOffsetPct" > 0;
