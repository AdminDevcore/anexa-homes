-- CreateEnum
CREATE TYPE "BankRuleDirection" AS ENUM ('money_in', 'money_out', 'any');

-- CreateEnum
CREATE TYPE "BankRuleMatch" AS ENUM ('contains', 'equals', 'starts_with');

-- CreateTable
CREATE TABLE "bank_rules" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "bankAccountId" TEXT,
    "direction" "BankRuleDirection" NOT NULL DEFAULT 'any',
    "matchText" TEXT,
    "matchType" "BankRuleMatch" NOT NULL DEFAULT 'contains',
    "minAmountCents" INTEGER,
    "maxAmountCents" INTEGER,
    "accountId" TEXT NOT NULL,
    "vertical" "Industry",
    "vendorId" TEXT,
    "memo" TEXT,
    "autoPost" BOOLEAN NOT NULL DEFAULT false,
    "timesApplied" INTEGER NOT NULL DEFAULT 0,
    "lastAppliedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_rules_companyId_enabled_priority_idx" ON "bank_rules"("companyId", "enabled", "priority");

-- CreateIndex
CREATE INDEX "bank_rules_bankAccountId_idx" ON "bank_rules"("bankAccountId");

-- CreateIndex
CREATE INDEX "bank_rules_accountId_idx" ON "bank_rules"("accountId");

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_rules" ADD CONSTRAINT "bank_rules_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "bookkeeping_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

