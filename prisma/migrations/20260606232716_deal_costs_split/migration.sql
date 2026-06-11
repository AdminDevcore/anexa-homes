-- Per-deal cost lines + rep split % + company overhead % (margin-based commissions).
CREATE TYPE "ProjectCostType" AS ENUM ('labor', 'material', 'other');
ALTER TABLE "users" ADD COLUMN "commissionSplitPct" DOUBLE PRECISION;
ALTER TABLE "companies" ADD COLUMN "overheadPct" DOUBLE PRECISION NOT NULL DEFAULT 10;
CREATE TABLE "project_costs" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "projectId" TEXT NOT NULL,
  "type" "ProjectCostType" NOT NULL DEFAULT 'material',
  "label" TEXT NOT NULL,
  "vendor" TEXT,
  "amount" INTEGER NOT NULL DEFAULT 0,
  "fileAssetId" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "project_costs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "project_costs_companyId_projectId_idx" ON "project_costs"("companyId", "projectId");
ALTER TABLE "project_costs" ADD CONSTRAINT "project_costs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;
