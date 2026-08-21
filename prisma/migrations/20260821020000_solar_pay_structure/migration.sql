-- How reps are paid on one lender's deals. Data, not a name check on "Amos".
-- CreateEnum
CREATE TYPE "SolarRepPayMode" AS ENUM ('redline', 'per_watt');

-- The rep's solar terms: a net redline per watt, and a fixed rate per watt for
-- lenders on per_watt pay and for lease/PPA. Null = unset, and those deals pay
-- nothing rather than silently generating a $0 line.
-- AlterTable
ALTER TABLE "users" ADD COLUMN     "solarPerWattMills" INTEGER,
ADD COLUMN     "solarRedlineCentsPerWatt" INTEGER;

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN     "repPayMode" "SolarRepPayMode" NOT NULL DEFAULT 'redline';

-- Snapshot of the solar terms at generation, so raising a rep's redline never
-- re-prices a deal they already sold. Null on every roofing line.
-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "solarBasis" TEXT,
ADD COLUMN     "solarMillsPerWatt" INTEGER,
ADD COLUMN     "solarRedlineCentsPerWatt" INTEGER;
