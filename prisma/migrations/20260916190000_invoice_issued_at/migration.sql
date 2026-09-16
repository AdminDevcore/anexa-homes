
-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
-- Existing invoices predate this column, so their best available issue date is
-- the day the row was written. This UPDATE targets a column that did not exist
-- one statement earlier, so it cannot overwrite a value anybody entered.
UPDATE "invoices" SET "issuedAt" = "createdAt";
