
-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('draft', 'submitted', 'approved', 'sent', 'settled', 'returned', 'failed', 'cancelled');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('ach', 'check', 'card', 'other');

-- CreateEnum
CREATE TYPE "PayeeAccountType" AS ENUM ('checking', 'savings');

-- CreateTable
CREATE TABLE "payees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vendorId" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT,
    "routingNumberEnc" TEXT,
    "accountNumberEnc" TEXT,
    "accountLast4" TEXT,
    "accountType" "PayeeAccountType",
    "bankDetailsUpdatedAt" TIMESTAMP(3),
    "bankDetailsUpdatedById" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "payeeId" TEXT NOT NULL,
    "billId" TEXT,
    "amountCents" INTEGER NOT NULL,
    "method" "PaymentMethod" NOT NULL DEFAULT 'ach',
    "status" "PaymentStatus" NOT NULL DEFAULT 'draft',
    "memo" TEXT,
    "bankAccountId" TEXT,
    "createdById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvalMfaStep" BIGINT,
    "providerId" TEXT,
    "providerTransferId" TEXT,
    "sentAt" TIMESTAMP(3),
    "settledAt" TIMESTAMP(3),
    "returnedAt" TIMESTAMP(3),
    "returnCode" TEXT,
    "returnReason" TEXT,
    "journalEntryId" TEXT,
    "reversalEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "paymentId" TEXT,
    "providerId" TEXT NOT NULL,
    "providerEventId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_mfa" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "secretEnc" TEXT NOT NULL,
    "enrolledAt" TIMESTAMP(3),
    "lastStep" BIGINT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_mfa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mfa_recovery_codes" (
    "id" TEXT NOT NULL,
    "mfaId" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "usedAt" TIMESTAMP(3),

    CONSTRAINT "mfa_recovery_codes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "payees_companyId_active_idx" ON "payees"("companyId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "payees_companyId_name_key" ON "payees"("companyId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "payments_journalEntryId_key" ON "payments"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_reversalEntryId_key" ON "payments"("reversalEntryId");

-- CreateIndex
CREATE INDEX "payments_companyId_status_createdAt_idx" ON "payments"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "payments_payeeId_idx" ON "payments"("payeeId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_companyId_providerTransferId_key" ON "payments"("companyId", "providerTransferId");

-- CreateIndex
CREATE INDEX "payment_events_companyId_receivedAt_idx" ON "payment_events"("companyId", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_providerId_providerEventId_key" ON "payment_events"("providerId", "providerEventId");

-- CreateIndex
CREATE UNIQUE INDEX "user_mfa_userId_key" ON "user_mfa"("userId");

-- CreateIndex
CREATE INDEX "mfa_recovery_codes_mfaId_idx" ON "mfa_recovery_codes"("mfaId");

-- CreateIndex
CREATE UNIQUE INDEX "mfa_recovery_codes_mfaId_codeHash_key" ON "mfa_recovery_codes"("mfaId", "codeHash");

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payees" ADD CONSTRAINT "payees_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "bookkeeping_vendors"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_payeeId_fkey" FOREIGN KEY ("payeeId") REFERENCES "payees"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_billId_fkey" FOREIGN KEY ("billId") REFERENCES "bills"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reversalEntryId_fkey" FOREIGN KEY ("reversalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_mfa" ADD CONSTRAINT "user_mfa_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mfa_recovery_codes" ADD CONSTRAINT "mfa_recovery_codes_mfaId_fkey" FOREIGN KEY ("mfaId") REFERENCES "user_mfa"("id") ON DELETE CASCADE ON UPDATE CASCADE;

