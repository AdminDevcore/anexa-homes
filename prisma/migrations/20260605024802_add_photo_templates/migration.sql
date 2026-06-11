-- CreateEnum
CREATE TYPE "PhotoTemplateKind" AS ENUM ('site', 'install');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "photoTemplateItemId" TEXT;

-- CreateTable
CREATE TABLE "photo_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" "PhotoTemplateKind" NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "photo_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "photo_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT false,
    "position" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "photo_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "photo_templates_companyId_kind_idx" ON "photo_templates"("companyId", "kind");

-- CreateIndex
CREATE INDEX "photo_template_items_templateId_idx" ON "photo_template_items"("templateId");

-- CreateIndex
CREATE INDEX "files_photoTemplateItemId_idx" ON "files"("photoTemplateItemId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_photoTemplateItemId_fkey" FOREIGN KEY ("photoTemplateItemId") REFERENCES "photo_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_templates" ADD CONSTRAINT "photo_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "photo_template_items" ADD CONSTRAINT "photo_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "photo_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
