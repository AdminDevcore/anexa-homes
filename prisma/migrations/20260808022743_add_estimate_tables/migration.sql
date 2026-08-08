-- CreateTable
CREATE TABLE "estimates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'roofing',
    "leadId" TEXT NOT NULL,
    "costTemplateId" TEXT,
    "discountCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "estimates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "estimate_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "estimateId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "catalogItemId" TEXT,
    "category" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "unitPriceCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "estimate_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "estimates_leadId_key" ON "estimates"("leadId");

-- CreateIndex
CREATE INDEX "estimates_companyId_leadId_idx" ON "estimates"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "estimate_lines_estimateId_idx" ON "estimate_lines"("estimateId");

-- CreateIndex
CREATE INDEX "estimate_lines_catalogItemId_idx" ON "estimate_lines"("catalogItemId");

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimates" ADD CONSTRAINT "estimates_costTemplateId_fkey" FOREIGN KEY ("costTemplateId") REFERENCES "scope_cost_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_estimateId_fkey" FOREIGN KEY ("estimateId") REFERENCES "estimates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "estimate_lines" ADD CONSTRAINT "estimate_lines_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "scope_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
