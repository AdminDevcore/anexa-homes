-- Solar compensation: terms frozen at signing, and the company's take on a
-- company-provided lead.
--
-- ADDITIVE ONLY. Every column is nullable and every default is the behaviour
-- that already exists, so this migration changes no money on any deal until
-- somebody configures a company-lead take and M1 finalises a classification.
--
-- NOTE ON cash_bids: `prisma migrate diff` also wanted to emit
--   DROP TABLE "cash_bids"; DROP TYPE "CashBidStatus";
-- and both have been deliberately removed. That table is schema drift left by
-- 20260808005832_drop_cash_bids, which was resolved-not-run on purpose because
-- production may hold SIGNED customer bids. See
-- scratchpad/remediation/CASH_BIDS_RECONCILIATION_PLAN.md. Dropping it is a
-- separate, deliberate decision and must never ride along with an unrelated
-- migration.

-- What the basis produced before the company's cut, and the rate that was cut.
ALTER TABLE "commissions"
  ADD COLUMN "solarGrossAmount" INTEGER,
  ADD COLUMN "solarCompanyLeadTakePct" DOUBLE PRECISION;

-- The COMPANY's percentage of this rep's solar commission on a company-provided
-- lead. NOT the rep's share — the opposite convention to providedLeadSplitPct.
ALTER TABLE "users"
  ADD COLUMN "solarCompanyLeadTakePct" DOUBLE PRECISION;

-- One row per solar deal, written when the customer signs.
CREATE TABLE "solar_deal_comp" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "basis" TEXT NOT NULL,
    "redlineCentsPerWatt" INTEGER,
    "millsPerWatt" INTEGER,
    "redlinePerBatteryCents" INTEGER,
    "perBatteryFlatCents" INTEGER,
    "signedAt" TIMESTAMP(3) NOT NULL,
    "companyProvidedLead" BOOLEAN,
    "companyLeadTakePct" DOUBLE PRECISION,
    "leadClassFinalizedAt" TIMESTAMP(3),
    "leadClassFinalizedBy" TEXT,
    "reassignedFromId" TEXT,
    "reassignedById" TEXT,
    "reassignedAt" TIMESTAMP(3),
    "reassignReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_deal_comp_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "solar_deal_comp_leadId_key" ON "solar_deal_comp"("leadId");
CREATE INDEX "solar_deal_comp_companyId_repId_idx" ON "solar_deal_comp"("companyId", "repId");

ALTER TABLE "solar_deal_comp" ADD CONSTRAINT "solar_deal_comp_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "solar_deal_comp" ADD CONSTRAINT "solar_deal_comp_leadId_fkey"
  FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "solar_deal_comp" ADD CONSTRAINT "solar_deal_comp_repId_fkey"
  FOREIGN KEY ("repId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "solar_deal_comp" ADD CONSTRAINT "solar_deal_comp_reassignedFromId_fkey"
  FOREIGN KEY ("reassignedFromId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
