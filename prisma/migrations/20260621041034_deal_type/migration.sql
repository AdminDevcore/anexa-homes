-- CreateEnum
CREATE TYPE "DealType" AS ENUM ('insurance', 'cash');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "dealType" "DealType" NOT NULL DEFAULT 'insurance';
