-- How a rep is paid on a job that sells STORAGE ONLY.
--
-- Every value of "SolarRepPayMode" is denominated in watts, and a battery-only
-- job has none. Until this migration a storage deal therefore produced NO
-- commission line at all: on a per-watt partner the resolver refused it (there
-- was nothing in the data that could say what the rep was owed), and on a
-- redline partner it came out unconfigured, because the rep column that would
-- have answered -- "solarRedlinePerBatteryCents", added earlier -- was never
-- writable from any screen and is null on every row in production.
--
-- Wholly additive. "batteryPayMode" defaults to 'redline', which is what the
-- resolver already assumed of any lender it could answer for, so no lender
-- changes behaviour on the day this lands; and both rep columns are nullable,
-- where null keeps meaning "write no line" rather than "pay zero".

-- CreateEnum
CREATE TYPE "SolarBatteryPayMode" AS ENUM ('redline', 'flat');

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN     "batteryPayMode" "SolarBatteryPayMode" NOT NULL DEFAULT 'redline';

-- The rep's flat rate per installed battery. Cents, not mills: a battery is a
-- $1,500 unit, so a tenth of a cent of one is noise.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "solarPerBatteryFlatCents" INTEGER;

-- Snapshotted onto the line at generation, beside the three terms already held
-- there, so raising a rep's rate never re-prices a deal they already sold.
-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "solarPerBatteryFlatCents" INTEGER;
