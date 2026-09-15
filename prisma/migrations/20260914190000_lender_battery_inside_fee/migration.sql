-- Whether a lender's dealer fee is taken on a battery beside an array.
-- Defaults to true: the fee is a share of the whole final price, battery
-- included. Turn it off per lender to keep the battery on top at its catalogue
-- price, which is how every lender priced before this column existed.
ALTER TABLE "solar_lenders" ADD COLUMN "batteryInsideFee" BOOLEAN NOT NULL DEFAULT true;
