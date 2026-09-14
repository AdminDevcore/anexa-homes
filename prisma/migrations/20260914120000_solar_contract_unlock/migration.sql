-- A super admin's permission to rewrite one signed contract, and the reason.
--
-- A signature freezes a solar deal's economics. Designs genuinely change between
-- contract and install, so the business needs a way through — what it must never
-- be is a silent one. This row is the decision: who, when, why, and until when.
--
-- Additive. No existing behaviour changes until somebody unlocks a contract.
CREATE TABLE "solar_contract_unlocks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "unlockedById" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_contract_unlocks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solar_contract_unlocks_companyId_leadId_expiresAt_idx"
    ON "solar_contract_unlocks"("companyId", "leadId", "expiresAt");

ALTER TABLE "solar_contract_unlocks" ADD CONSTRAINT "solar_contract_unlocks_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_contract_unlocks" ADD CONSTRAINT "solar_contract_unlocks_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
