-- CreateTable
CREATE TABLE "scope_cost_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_cost_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_cost_template_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "costPerUnitCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_cost_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_supplement_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "effectiveDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_supplement_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_supplement_template_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "catalogItemId" TEXT NOT NULL,
    "supplementPerUnitCents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT,
    "requiredEvidence" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_supplement_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scope_cost_templates_companyId_idx" ON "scope_cost_templates"("companyId");

-- CreateIndex
CREATE INDEX "scope_cost_template_items_templateId_idx" ON "scope_cost_template_items"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "scope_cost_template_items_templateId_catalogItemId_key" ON "scope_cost_template_items"("templateId", "catalogItemId");

-- CreateIndex
CREATE INDEX "scope_supplement_templates_companyId_idx" ON "scope_supplement_templates"("companyId");

-- CreateIndex
CREATE INDEX "scope_supplement_template_items_templateId_idx" ON "scope_supplement_template_items"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "scope_supplement_template_items_templateId_catalogItemId_key" ON "scope_supplement_template_items"("templateId", "catalogItemId");

-- AddForeignKey
ALTER TABLE "scope_cost_templates" ADD CONSTRAINT "scope_cost_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_cost_template_items" ADD CONSTRAINT "scope_cost_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "scope_cost_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_cost_template_items" ADD CONSTRAINT "scope_cost_template_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "scope_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_supplement_templates" ADD CONSTRAINT "scope_supplement_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_supplement_template_items" ADD CONSTRAINT "scope_supplement_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "scope_supplement_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_supplement_template_items" ADD CONSTRAINT "scope_supplement_template_items_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "scope_catalog_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
