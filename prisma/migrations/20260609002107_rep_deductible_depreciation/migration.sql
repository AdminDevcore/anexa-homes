-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "depreciationCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "repGetsDepreciation" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "repGetsSupplement" BOOLEAN NOT NULL DEFAULT true;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "deductiblePct" DOUBLE PRECISION;
