-- CreateTable
CREATE TABLE "scope_catalog_items" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "category" TEXT NOT NULL DEFAULT 'General',
    "subcategory" TEXT NOT NULL DEFAULT '',
    "description" TEXT NOT NULL DEFAULT '',
    "unit" TEXT NOT NULL DEFAULT 'EA',
    "trade" TEXT NOT NULL DEFAULT 'General',
    "isCommonInsuranceItem" BOOLEAN NOT NULL DEFAULT false,
    "isSupplementEligible" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "scope_catalog_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "scope_catalog_items_companyId_trade_idx" ON "scope_catalog_items"("companyId", "trade");

-- CreateIndex
CREATE INDEX "scope_catalog_items_companyId_category_idx" ON "scope_catalog_items"("companyId", "category");

-- AddForeignKey
ALTER TABLE "scope_catalog_items" ADD CONSTRAINT "scope_catalog_items_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
