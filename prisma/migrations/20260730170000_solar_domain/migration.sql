-- ===========================================================================
-- Solar domain model (Phase 4)
--
-- Purely additive: five new types, five new tables, two new CommissionType
-- values. Nothing existing is altered, so the live roofing business is
-- untouched and pre-change code ignores all of it.
--
-- Roofing-only concepts (Claim, RoofReport, the insurance scope) are NOT
-- dropped. They hold live roofing money. Solar simply never creates them and
-- never renders them — see isSolarDeal() in the deal page.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "FinanceProduct" AS ENUM ('cash', 'loan', 'lease', 'ppa');

-- CreateEnum
CREATE TYPE "CreditStatus" AS ENUM ('not_submitted', 'submitted', 'approved', 'conditional', 'declined', 'expired');

-- CreateEnum
CREATE TYPE "MountType" AS ENUM ('roof', 'ground');

-- CreateEnum
CREATE TYPE "SolarEquipmentKind" AS ENUM ('module', 'inverter', 'battery', 'adder');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CommissionType" ADD VALUE 'ppw';
ALTER TYPE "CommissionType" ADD VALUE 'margin';

-- CreateTable
CREATE TABLE "solar_settings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "derateFactor" DOUBLE PRECISION NOT NULL DEFAULT 0.84,
    "annualDegradationPct" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "utilityEscalationPct" DOUBLE PRECISION NOT NULL DEFAULT 3.5,
    "kwhPerKwYear" INTEGER NOT NULL DEFAULT 1450,
    "defaultGrossPpwCents" INTEGER NOT NULL DEFAULT 350,
    "defaultDealerFeePct" DOUBLE PRECISION NOT NULL DEFAULT 18,
    "federalItcPct" DOUBLE PRECISION,
    "stateIncentiveNote" TEXT,
    "incentiveDisclaimer" TEXT NOT NULL DEFAULT 'Estimated only and not a guarantee. Tax credits depend on your individual tax situation and on rules that may change. Consult your tax advisor.',
    "minOffsetPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "maxOffsetPct" DOUBLE PRECISION NOT NULL DEFAULT 150,
    "minPpwCents" INTEGER NOT NULL DEFAULT 150,
    "maxPpwCents" INTEGER NOT NULL DEFAULT 800,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_settings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_equipment" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "kind" "SolarEquipmentKind" NOT NULL,
    "manufacturer" TEXT,
    "model" TEXT NOT NULL,
    "ratingW" INTEGER,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "crossoverKind" TEXT,
    "specs" JSONB NOT NULL DEFAULT '{}',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_equipment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_designs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "utilityProvider" TEXT,
    "ratePlan" TEXT,
    "utilityAccountNo" TEXT,
    "meterNo" TEXT,
    "netMeteringProgram" TEXT,
    "monthlyUsageKwh" JSONB NOT NULL DEFAULT '[]',
    "annualUsageKwh" INTEGER,
    "avgMonthlyBillCents" INTEGER,
    "mountType" "MountType" NOT NULL DEFAULT 'roof',
    "roofPlanes" JSONB NOT NULL DEFAULT '[]',
    "tsrfPct" DOUBLE PRECISION,
    "setbackNotes" TEXT,
    "structuralNotes" TEXT,
    "electricalNotes" TEXT,
    "moduleId" TEXT,
    "moduleQty" INTEGER NOT NULL DEFAULT 0,
    "inverterId" TEXT,
    "batteryId" TEXT,
    "batteryQty" INTEGER NOT NULL DEFAULT 0,
    "systemSizeKwDc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "systemSizeKwAc" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "year1ProductionKwh" INTEGER NOT NULL DEFAULT 0,
    "offsetPct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "planSetFileId" TEXT,
    "singleLineFileId" TEXT,
    "loadCalcFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_designs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_finance" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "product" "FinanceProduct" NOT NULL DEFAULT 'cash',
    "grossPpwCents" INTEGER NOT NULL DEFAULT 0,
    "dealerFeePct" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "adderTotalCents" INTEGER NOT NULL DEFAULT 0,
    "contractPriceCents" INTEGER NOT NULL DEFAULT 0,
    "itcEstimateCents" INTEGER NOT NULL DEFAULT 0,
    "rateMillsPerKwh" INTEGER,
    "monthlyPaymentCents" INTEGER,
    "escalatorPct" DOUBLE PRECISION,
    "termYears" INTEGER,
    "aprPct" DOUBLE PRECISION,
    "loanTermMonths" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_finance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "credit_applications" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "lender" TEXT NOT NULL,
    "status" "CreditStatus" NOT NULL DEFAULT 'not_submitted',
    "externalId" TEXT,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "termMonths" INTEGER,
    "aprPct" DOUBLE PRECISION,
    "dealerFeePct" DOUBLE PRECISION,
    "stipulations" JSONB NOT NULL DEFAULT '[]',
    "submittedAt" TIMESTAMP(3),
    "decidedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "credit_applications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solar_settings_companyId_key" ON "solar_settings"("companyId");

-- CreateIndex
CREATE INDEX "solar_equipment_companyId_kind_isActive_idx" ON "solar_equipment"("companyId", "kind", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "solar_designs_leadId_key" ON "solar_designs"("leadId");

-- CreateIndex
CREATE INDEX "solar_designs_companyId_vertical_idx" ON "solar_designs"("companyId", "vertical");

-- CreateIndex
CREATE UNIQUE INDEX "solar_finance_leadId_key" ON "solar_finance"("leadId");

-- CreateIndex
CREATE INDEX "solar_finance_companyId_vertical_idx" ON "solar_finance"("companyId", "vertical");

-- CreateIndex
CREATE INDEX "credit_applications_companyId_leadId_idx" ON "credit_applications"("companyId", "leadId");

-- CreateIndex
CREATE INDEX "credit_applications_companyId_status_idx" ON "credit_applications"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "credit_applications_companyId_lender_externalId_key" ON "credit_applications"("companyId", "lender", "externalId");

-- AddForeignKey
ALTER TABLE "solar_settings" ADD CONSTRAINT "solar_settings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_equipment" ADD CONSTRAINT "solar_equipment_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_designs" ADD CONSTRAINT "solar_designs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_designs" ADD CONSTRAINT "solar_designs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_designs" ADD CONSTRAINT "solar_designs_moduleId_fkey" FOREIGN KEY ("moduleId") REFERENCES "solar_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_designs" ADD CONSTRAINT "solar_designs_inverterId_fkey" FOREIGN KEY ("inverterId") REFERENCES "solar_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_designs" ADD CONSTRAINT "solar_designs_batteryId_fkey" FOREIGN KEY ("batteryId") REFERENCES "solar_equipment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_finance" ADD CONSTRAINT "solar_finance_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_finance" ADD CONSTRAINT "solar_finance_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "credit_applications" ADD CONSTRAINT "credit_applications_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

