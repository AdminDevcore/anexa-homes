-- AlterTable
ALTER TABLE "cash_bids" ADD COLUMN     "warrantyManufacturerYears" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN     "warrantyWorkmanshipYears" INTEGER NOT NULL DEFAULT 5;
