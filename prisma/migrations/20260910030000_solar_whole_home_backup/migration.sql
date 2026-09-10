-- Whole-home backup: runtime is derived from the home's own usage, and the
-- company's list of named load profiles goes away.
--
-- The profiles sold "Essentials / Essentials + AC / Whole home" as three
-- coverage tiers a customer picks between. This company only ever installs
-- whole-home backup, so the menu described a product nobody offers — and worse,
-- one company-wide wattage divided every battery, quoting a condo and a
-- four-bedroom house the same hours off the same stack.
--
-- Runtime now comes from the deal's own annual usage:
--
--     average W = annual kWh × 1000 ÷ 8760
--     outage W  = average × backupOutageDrawFactor
--     hours     = usable kWh ÷ (outage W ÷ 1000)
--
-- 1.3 is the default margin over the yearly average, because an outage is not
-- an average moment — the power goes out in a heatwave with the AC running.

-- AlterTable
ALTER TABLE "solar_settings" ADD COLUMN     "backupOutageDrawFactor" DOUBLE PRECISION NOT NULL DEFAULT 1.3;

-- DROPPED, not retired in place. Nothing already sold loses anything: every
-- proposal ever generated froze its own copy of the rows it used into its
-- snapshot JSON, so the record of what a signed document promised lives with
-- the document and not in this table. What is left here is three rows of
-- company configuration for a product that is no longer offered, and leaving a
-- live model behind invites somebody to wire it back up.
-- DropForeignKey
ALTER TABLE "solar_backup_profiles" DROP CONSTRAINT "solar_backup_profiles_companyId_fkey";

-- DropTable
DROP TABLE "solar_backup_profiles";
