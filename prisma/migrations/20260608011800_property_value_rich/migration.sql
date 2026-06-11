-- AlterTable
ALTER TABLE "knocks" ADD COLUMN     "propertyData" JSONB;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "propertyData" JSONB;

-- AlterTable
ALTER TABLE "property_values" ADD COLUMN     "data" JSONB,
ADD COLUMN     "matched" BOOLEAN NOT NULL DEFAULT false;
