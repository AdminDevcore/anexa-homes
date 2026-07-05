-- AlterTable
ALTER TABLE "reviews" ADD COLUMN     "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Backfill: move any existing single photo into the new array.
UPDATE "reviews" SET "photoKeys" = ARRAY["photoKey"]
WHERE "photoKey" IS NOT NULL AND cardinality("photoKeys") = 0;
