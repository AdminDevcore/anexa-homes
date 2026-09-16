-- CreateEnum
CREATE TYPE "BillStatus" AS ENUM ('draft', 'open', 'paid', 'void');

-- CreateEnum
CREATE TYPE "FundingMilestone" AS ENUM ('m1', 'm2', 'final', 'other');

-- CreateEnum
CREATE TYPE "FundingStatus" AS ENUM ('expected', 'received', 'short', 'over', 'void');

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "journalEntryId" TEXT;

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN     "fundingM1Pct" DOUBLE PRECISION,
ADD COLUMN     "fundingM2Pct" DOUBLE PRECISION,
ADD COLUMN     "fundingToleranceCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "fundsNetOfDealerFee" BOOLEAN NOT NULL DEFAULT true;

-- CreateTable
CREATE TABLE "bills" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry",
    "vendorId" TEXT NOT NULL,
    "billNumber" TEXT NOT NULL,
    "status" "BillStatus" NOT NULL DEFAULT 'open',
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "billedAt" TIMESTAMP(3) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "projectId" TEXT,
    "expenseAccountId" TEXT,
    "journalEntryId" TEXT,
    "memo" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lender_fundings" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "lenderId" TEXT,
    "milestone" "FundingMilestone" NOT NULL DEFAULT 'm1',
    "expectedCents" INTEGER NOT NULL DEFAULT 0,
    "receivedCents" INTEGER NOT NULL DEFAULT 0,
    "status" "FundingStatus" NOT NULL DEFAULT 'expected',
    "expectedAt" TIMESTAMP(3),
    "receivedAt" TIMESTAMP(3),
    "bankFeedTransactionId" TEXT,
    "journalEntryId" TEXT,
    "memo" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lender_fundings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bills_journalEntryId_key" ON "bills"("journalEntryId");

-- CreateIndex
CREATE INDEX "bills_companyId_status_dueAt_idx" ON "bills"("companyId", "status", "dueAt");

-- CreateIndex
CREATE INDEX "bills_vendorId_idx" ON "bills"("vendorId");

-- CreateIndex
CREATE UNIQUE INDEX "bills_companyId_billNumber_key" ON "bills"("companyId", "billNumber");

-- CreateIndex
CREATE UNIQUE INDEX "lender_fundings_bankFeedTransactionId_key" ON "lender_fundings"("bankFeedTransactionId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_fundings_journalEntryId_key" ON "lender_fundings"("journalEntryId");

-- CreateIndex
CREATE INDEX "lender_fundings_companyId_status_idx" ON "lender_fundings"("companyId", "status");

-- CreateIndex
CREATE INDEX "lender_fundings_leadId_idx" ON "lender_fundings"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "lender_fundings_companyId_leadId_milestone_key" ON "lender_fundings"("companyId", "leadId", "milestone");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_journalEntryId_key" ON "invoices"("journalEntryId");

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "bookkeeping_vendors"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_expenseAccountId_fkey" FOREIGN KEY ("expenseAccountId") REFERENCES "ledger_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bills" ADD CONSTRAINT "bills_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_fundings" ADD CONSTRAINT "lender_fundings_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_fundings" ADD CONSTRAINT "lender_fundings_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_fundings" ADD CONSTRAINT "lender_fundings_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "solar_lenders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_fundings" ADD CONSTRAINT "lender_fundings_bankFeedTransactionId_fkey" FOREIGN KEY ("bankFeedTransactionId") REFERENCES "bank_feed_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lender_fundings" ADD CONSTRAINT "lender_fundings_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

