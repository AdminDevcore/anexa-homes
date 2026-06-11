-- CreateTable
CREATE TABLE "roof_reports" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "facets" JSONB NOT NULL,
    "footprintArea" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "roofArea" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "squares" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "facetCount" INTEGER NOT NULL DEFAULT 0,
    "predominantPitch" TEXT,
    "perimeterFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "ridgeFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "hipFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "valleyFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "eaveFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rakeFt" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "wastePct" DOUBLE PRECISION NOT NULL DEFAULT 12,
    "squaresToOrder" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "preparedBy" TEXT,
    "reportFileId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual_trace',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roof_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "roof_reports_leadId_key" ON "roof_reports"("leadId");

-- CreateIndex
CREATE INDEX "roof_reports_companyId_idx" ON "roof_reports"("companyId");

-- AddForeignKey
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "roof_reports" ADD CONSTRAINT "roof_reports_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
