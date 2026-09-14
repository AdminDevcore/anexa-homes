-- CreateTable
CREATE TABLE "pipeline_filter_views" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'roofing',
    "createdById" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pipeline_filter_views_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pipeline_filter_views_companyId_vertical_shared_idx" ON "pipeline_filter_views"("companyId", "vertical", "shared");

-- CreateIndex
CREATE INDEX "pipeline_filter_views_createdById_idx" ON "pipeline_filter_views"("createdById");

-- AddForeignKey
ALTER TABLE "pipeline_filter_views" ADD CONSTRAINT "pipeline_filter_views_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pipeline_filter_views" ADD CONSTRAINT "pipeline_filter_views_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

