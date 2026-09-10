-- Auto-sized batteries: the count follows the home's night load instead of a
-- flat company default.
--
-- Three columns, all defaulted so nothing already sold moves. `autoBatteryQty`
-- is FALSE, which is today's behaviour exactly — turning it on changes what
-- every storage deal in the pipeline quotes, and that is a decision somebody
-- makes on the settings screen, not one that arrives with a deploy.

-- AlterTable
ALTER TABLE "solar_settings" ADD COLUMN     "autoBatteryQty" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "batteryNightSharePct" DOUBLE PRECISION NOT NULL DEFAULT 55;

-- The latch that makes a rep's own count survive a recompute. FALSE on every
-- existing design is right: no rep has ever typed a count in a world where
-- anything would overwrite it, so there is nothing to protect retroactively —
-- and marking them all "set by hand" would lock every deal in the pipeline out
-- of auto-sizing the moment it is switched on.
-- AlterTable
ALTER TABLE "solar_designs" ADD COLUMN     "batteryQtySetByRep" BOOLEAN NOT NULL DEFAULT false;
