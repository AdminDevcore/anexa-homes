-- CreateTable
CREATE TABLE "scopes_of_work" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "industry" "Industry" NOT NULL DEFAULT 'roofing',
    "pdfFileId" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scopes_of_work_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT NOT NULL DEFAULT '',
    "quantity" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "unit" TEXT,
    "insuranceUnitPrice" INTEGER NOT NULL DEFAULT 0,
    "costUnitPrice" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "scope_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scope_template_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "industry" "Industry" NOT NULL DEFAULT 'roofing',
    "position" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'General',
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT,
    "defaultInsuranceUnitPrice" INTEGER NOT NULL DEFAULT 0,
    "defaultCostUnitPrice" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "scopes_of_work_leadId_key" ON "scopes_of_work"("leadId");

-- CreateIndex
CREATE INDEX "scopes_of_work_companyId_leadId_idx" ON "scopes_of_work"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "scope_lines_scopeId_idx" ON "scope_lines"("scopeId");

-- CreateIndex
CREATE INDEX "scope_template_items_companyId_industry_idx" ON "scope_template_items"("companyId", "industry");

-- AddForeignKey
ALTER TABLE "scopes_of_work" ADD CONSTRAINT "scopes_of_work_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scopes_of_work" ADD CONSTRAINT "scopes_of_work_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_lines" ADD CONSTRAINT "scope_lines_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_lines" ADD CONSTRAINT "scope_lines_scopeId_fkey" FOREIGN KEY ("scopeId") REFERENCES "scopes_of_work"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_template_items" ADD CONSTRAINT "scope_template_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
