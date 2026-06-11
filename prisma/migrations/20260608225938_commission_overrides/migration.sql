-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "overrideId" TEXT;

-- CreateTable
CREATE TABLE "commission_overrides" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "beneficiaryId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "type" "CommissionType" NOT NULL DEFAULT 'percentage',
    "percent" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "flatAmount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commission_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "commission_overrides_companyId_sourceId_idx" ON "commission_overrides"("companyId", "sourceId");

-- CreateIndex
CREATE UNIQUE INDEX "commission_overrides_companyId_beneficiaryId_sourceId_key" ON "commission_overrides"("companyId", "beneficiaryId", "sourceId");

-- AddForeignKey
ALTER TABLE "commissions" ADD CONSTRAINT "commissions_overrideId_fkey" FOREIGN KEY ("overrideId") REFERENCES "commission_overrides"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_overrides" ADD CONSTRAINT "commission_overrides_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_overrides" ADD CONSTRAINT "commission_overrides_beneficiaryId_fkey" FOREIGN KEY ("beneficiaryId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commission_overrides" ADD CONSTRAINT "commission_overrides_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
