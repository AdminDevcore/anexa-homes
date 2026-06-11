-- CreateEnum
CREATE TYPE "ServiceType" AS ENUM ('roofing', 'storm_restoration', 'solar', 'hvac', 'water_filtration', 'windows', 'other');

-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN     "sourcePdfKey" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "serviceType" "ServiceType" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "serviceType" "ServiceType" NOT NULL DEFAULT 'roofing';
