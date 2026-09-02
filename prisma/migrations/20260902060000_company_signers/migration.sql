-- AlterTable
ALTER TABLE "document_templates" ADD COLUMN     "companySignerId" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "coOwnerEmail" TEXT,
ADD COLUMN     "coOwnerPhone" TEXT;

-- CreateTable
CREATE TABLE "company_signers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT,
    "email" TEXT,
    "phone" TEXT,
    "licenseNumber" TEXT,
    "credentials" JSONB NOT NULL DEFAULT '[]',
    "signatureData" TEXT,
    "initialsData" TEXT,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "company_signers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "company_signers_companyId_active_idx" ON "company_signers"("companyId", "active");

-- AddForeignKey
ALTER TABLE "company_signers" ADD CONSTRAINT "company_signers_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_templates" ADD CONSTRAINT "document_templates_companySignerId_fkey" FOREIGN KEY ("companySignerId") REFERENCES "company_signers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

