-- CreateEnum (idempotent: an earlier migration may have created this already)
DO $$ BEGIN
  CREATE TYPE "Industry" AS ENUM ('roofing', 'solar', 'water');
EXCEPTION WHEN duplicate_object THEN null;
END $$;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "industry" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "pipelines" ADD COLUMN     "industry" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "industries" "Industry"[] DEFAULT ARRAY['roofing', 'solar', 'water']::"Industry"[];

-- CreateIndex
CREATE INDEX "leads_companyId_industry_idx" ON "leads"("companyId", "industry");

-- CreateIndex
CREATE INDEX "pipelines_companyId_industry_idx" ON "pipelines"("companyId", "industry");
