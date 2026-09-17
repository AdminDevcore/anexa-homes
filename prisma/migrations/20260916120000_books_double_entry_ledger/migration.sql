-- CreateEnum
CREATE TYPE "LedgerAccountType" AS ENUM ('asset', 'liability', 'equity', 'income', 'cogs', 'expense', 'other_income', 'other_expense');

-- CreateEnum
CREATE TYPE "LedgerAccountSubtype" AS ENUM ('bank', 'undeposited_funds', 'accounts_receivable', 'other_current_asset', 'fixed_asset', 'accounts_payable', 'credit_card', 'other_current_liability', 'long_term_liability', 'equity', 'income', 'cogs', 'expense', 'other_income', 'other_expense');

-- CreateEnum
CREATE TYPE "JournalEntryStatus" AS ENUM ('posted', 'void');

-- CreateEnum
CREATE TYPE "BankAccountKind" AS ENUM ('checking', 'savings', 'credit_card');

-- CreateTable
CREATE TABLE "ledger_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" "LedgerAccountType" NOT NULL,
    "subtype" "LedgerAccountSubtype" NOT NULL,
    "parentId" TEXT,
    "description" TEXT,
    "taxLine" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "systemKey" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ledger_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_entries" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "memo" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "status" "JournalEntryStatus" NOT NULL DEFAULT 'posted',
    "reversesId" TEXT,
    "voidReason" TEXT,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "lockOverrideReason" TEXT,
    "createdById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "journal_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "journal_lines" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debitCents" INTEGER NOT NULL DEFAULT 0,
    "creditCents" INTEGER NOT NULL DEFAULT 0,
    "vertical" "Industry",
    "projectId" TEXT,
    "vendorId" TEXT,
    "memo" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "journal_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_accounts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "ledgerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "institution" TEXT,
    "mask" TEXT,
    "kind" "BankAccountKind" NOT NULL DEFAULT 'checking',
    "defaultVertical" "Industry",
    "openingBalanceCents" INTEGER NOT NULL DEFAULT 0,
    "openingBalanceDate" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "accounting_period_locks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "lockedThrough" TIMESTAMP(3) NOT NULL,
    "note" TEXT,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "accounting_period_locks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "actorId" TEXT,
    "actorLabel" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "before" JSONB,
    "after" JSONB,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ledger_accounts_companyId_type_idx" ON "ledger_accounts"("companyId", "type");

-- CreateIndex
CREATE INDEX "ledger_accounts_companyId_active_idx" ON "ledger_accounts"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_companyId_number_key" ON "ledger_accounts"("companyId", "number");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_accounts_companyId_systemKey_key" ON "ledger_accounts"("companyId", "systemKey");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_reversesId_key" ON "journal_entries"("reversesId");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_date_idx" ON "journal_entries"("companyId", "date");

-- CreateIndex
CREATE INDEX "journal_entries_companyId_status_idx" ON "journal_entries"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "journal_entries_companyId_sourceType_sourceId_key" ON "journal_entries"("companyId", "sourceType", "sourceId");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_accountId_idx" ON "journal_lines"("companyId", "accountId");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_projectId_idx" ON "journal_lines"("companyId", "projectId");

-- CreateIndex
CREATE INDEX "journal_lines_companyId_vendorId_idx" ON "journal_lines"("companyId", "vendorId");

-- CreateIndex
CREATE INDEX "journal_lines_entryId_idx" ON "journal_lines"("entryId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_ledgerAccountId_key" ON "bank_accounts"("ledgerAccountId");

-- CreateIndex
CREATE INDEX "bank_accounts_companyId_active_idx" ON "bank_accounts"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "accounting_period_locks_companyId_key" ON "accounting_period_locks"("companyId");

-- CreateIndex
CREATE INDEX "finance_audit_events_companyId_createdAt_idx" ON "finance_audit_events"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "finance_audit_events_companyId_entityType_entityId_idx" ON "finance_audit_events"("companyId", "entityType", "entityId");

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_accounts" ADD CONSTRAINT "ledger_accounts_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_reversesId_fkey" FOREIGN KEY ("reversesId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_entryId_fkey" FOREIGN KEY ("entryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "bookkeeping_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_ledgerAccountId_fkey" FOREIGN KEY ("ledgerAccountId") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounting_period_locks" ADD CONSTRAINT "accounting_period_locks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_audit_events" ADD CONSTRAINT "finance_audit_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

