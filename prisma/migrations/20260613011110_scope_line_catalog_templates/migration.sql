-- AlterTable
ALTER TABLE "scope_lines" ADD COLUMN     "catalogItemId" TEXT;

-- AlterTable
ALTER TABLE "scopes_of_work" ADD COLUMN     "costTemplateId" TEXT,
ADD COLUMN     "supplementTemplateId" TEXT;

-- CreateIndex
CREATE INDEX "scope_lines_catalogItemId_idx" ON "scope_lines"("catalogItemId");

-- AddForeignKey
ALTER TABLE "scopes_of_work" ADD CONSTRAINT "scopes_of_work_costTemplateId_fkey" FOREIGN KEY ("costTemplateId") REFERENCES "scope_cost_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scopes_of_work" ADD CONSTRAINT "scopes_of_work_supplementTemplateId_fkey" FOREIGN KEY ("supplementTemplateId") REFERENCES "scope_supplement_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scope_lines" ADD CONSTRAINT "scope_lines_catalogItemId_fkey" FOREIGN KEY ("catalogItemId") REFERENCES "scope_catalog_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;
