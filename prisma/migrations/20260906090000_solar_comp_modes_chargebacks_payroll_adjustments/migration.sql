-- Solar compensation completion: explicit adjustment modes, rep-owned battery
-- plans, $/W manager overrides, chargebacks, payroll adjustments and payroll
-- finalisation.
--
-- ADDITIVE AND HISTORY-SAFE. Every new column is nullable or carries a default
-- that reproduces today's behaviour:
--   users.solarLeadAdjustMode        DEFAULT 'none'  → no rep is adjusted
--   solar_deal_comp.leadAdjustMode   DEFAULT 'none'  → no signed deal is adjusted
--   solar_deal_comp.needsReview      DEFAULT false   → no deal is blocked
--   commission_overrides.perWattMills DEFAULT 0      → no override changes value
--   payroll_runs.finalizedAt         NULL            → no run is retroactively locked
-- No existing commission, payroll item or approved amount is touched.
--
-- NOTE ON cash_bids: `prisma migrate diff` again wanted to emit
--   DROP TABLE "cash_bids"; DROP TYPE "CashBidStatus";
-- and both are deliberately removed. See
-- scratchpad/remediation/CASH_BIDS_RECONCILIATION_PLAN.md — that table may hold
-- signed customer bids and dropping it is a separate, deliberate decision.

-- CreateEnum
CREATE TYPE "SolarLeadAdjustMode" AS ENUM ('none', 'percentage', 'flat');

-- CreateEnum
CREATE TYPE "SolarBatteryPayPlan" AS ENUM ('margin', 'flat');

-- CreateEnum
CREATE TYPE "ChargebackReason" AS ENUM ('fraud', 'fabricated_deal', 'misrepresentation', 'rep_misconduct', 'other_rep_caused');

-- CreateEnum
CREATE TYPE "ChargebackStatus" AS ENUM ('pending', 'approved', 'rejected', 'settled', 'voided');

-- CreateEnum
CREATE TYPE "PayrollAdjustmentKind" AS ENUM ('bonus', 'deduction', 'chargeback_recovery');

-- AlterTable
ALTER TABLE "commission_overrides" ADD COLUMN     "perWattMills" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "solarCompanyLeadFlatCents" INTEGER;

-- AlterTable
ALTER TABLE "payroll_runs" ADD COLUMN     "finalizedAt" TIMESTAMP(3),
ADD COLUMN     "finalizedById" TEXT;

-- AlterTable
ALTER TABLE "solar_deal_comp" ADD COLUMN     "companyLeadFlatCents" INTEGER,
ADD COLUMN     "leadAdjustMode" "SolarLeadAdjustMode" NOT NULL DEFAULT 'none',
ADD COLUMN     "needsReview" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "reviewNote" TEXT,
ADD COLUMN     "reviewResolvedAt" TIMESTAMP(3),
ADD COLUMN     "reviewResolvedById" TEXT;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "solarBatteryPayPlan" "SolarBatteryPayPlan",
ADD COLUMN     "solarCompanyLeadFlatCents" INTEGER,
ADD COLUMN     "solarLeadAdjustMode" "SolarLeadAdjustMode" NOT NULL DEFAULT 'none';



-- CreateTable
CREATE TABLE "chargebacks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "commissionId" TEXT,
    "projectId" TEXT,
    "leadId" TEXT,
    "userId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "reason" "ChargebackReason" NOT NULL,
    "notes" TEXT,
    "status" "ChargebackStatus" NOT NULL DEFAULT 'pending',
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedById" TEXT,
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chargebacks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chargeback_recoveries" (
    "id" TEXT NOT NULL,
    "chargebackId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "notes" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chargeback_recoveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payroll_adjustments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payrollRunId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" "PayrollAdjustmentKind" NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "reason" TEXT NOT NULL,
    "leadId" TEXT,
    "projectId" TEXT,
    "chargebackId" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payroll_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "chargebacks_companyId_userId_status_idx" ON "chargebacks"("companyId", "userId", "status");

-- CreateIndex
CREATE INDEX "chargebacks_companyId_projectId_idx" ON "chargebacks"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "chargeback_recoveries_chargebackId_idx" ON "chargeback_recoveries"("chargebackId");

-- CreateIndex
CREATE INDEX "chargeback_recoveries_payrollRunId_idx" ON "chargeback_recoveries"("payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_adjustments_companyId_payrollRunId_idx" ON "payroll_adjustments"("companyId", "payrollRunId");

-- CreateIndex
CREATE INDEX "payroll_adjustments_companyId_userId_idx" ON "payroll_adjustments"("companyId", "userId");

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_commissionId_fkey" FOREIGN KEY ("commissionId") REFERENCES "commissions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargebacks" ADD CONSTRAINT "chargebacks_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargeback_recoveries" ADD CONSTRAINT "chargeback_recoveries_chargebackId_fkey" FOREIGN KEY ("chargebackId") REFERENCES "chargebacks"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chargeback_recoveries" ADD CONSTRAINT "chargeback_recoveries_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_payrollRunId_fkey" FOREIGN KEY ("payrollRunId") REFERENCES "payroll_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payroll_adjustments" ADD CONSTRAINT "payroll_adjustments_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

