-- Which price a lender's $/W and $/battery figure fixes, per programme.
-- Both default to 'final' (fee included), which is what every programme did
-- before, so no existing quote moves.
CREATE TYPE "SolarPriceBasis" AS ENUM ('final', 'gross', 'base');

ALTER TABLE "solar_lender_products"
  ADD COLUMN "ppwBasis" "SolarPriceBasis" NOT NULL DEFAULT 'final',
  ADD COLUMN "batteryPriceBasis" "SolarPriceBasis" NOT NULL DEFAULT 'final';
