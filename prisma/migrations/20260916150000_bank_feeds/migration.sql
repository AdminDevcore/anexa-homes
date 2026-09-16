-- CreateEnum
CREATE TYPE "BankConnectionStatus" AS ENUM ('active', 'needs_reconnect', 'disconnected', 'error');

-- CreateEnum
CREATE TYPE "BankFeedTransactionStatus" AS ENUM ('review', 'posted', 'matched', 'excluded', 'removed');

-- CreateEnum
CREATE TYPE "WebhookEventStatus" AS ENUM ('received', 'processed', 'ignored', 'failed');

-- AlterTable
ALTER TABLE "bank_accounts" ADD COLUMN     "bankConnectionId" TEXT,
ADD COLUMN     "providerAccountId" TEXT;

-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'plaid',
    "providerItemId" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "accessTokenEnc" TEXT NOT NULL,
    "cursor" TEXT,
    "status" "BankConnectionStatus" NOT NULL DEFAULT 'active',
    "needsReconnectAt" TIMESTAMP(3),
    "lastSyncedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_feed_transactions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "bankConnectionId" TEXT,
    "bankAccountId" TEXT,
    "providerTransactionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "postedAt" TIMESTAMP(3) NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "description" TEXT NOT NULL,
    "merchantName" TEXT,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT[],
    "checkNumber" TEXT,
    "currency" TEXT NOT NULL DEFAULT 'USD',
    "status" "BankFeedTransactionStatus" NOT NULL DEFAULT 'review',
    "journalEntryId" TEXT,
    "removedAt" TIMESTAMP(3),
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_feed_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "webhook_events" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "companyId" TEXT,
    "code" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookEventStatus" NOT NULL DEFAULT 'received',
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processedAt" TIMESTAMP(3),
    "error" TEXT,

    CONSTRAINT "webhook_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bank_connections_companyId_status_idx" ON "bank_connections"("companyId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_companyId_provider_providerItemId_key" ON "bank_connections"("companyId", "provider", "providerItemId");

-- CreateIndex
CREATE INDEX "bank_feed_transactions_companyId_status_postedAt_idx" ON "bank_feed_transactions"("companyId", "status", "postedAt");

-- CreateIndex
CREATE INDEX "bank_feed_transactions_bankAccountId_postedAt_idx" ON "bank_feed_transactions"("bankAccountId", "postedAt");

-- CreateIndex
CREATE INDEX "bank_feed_transactions_journalEntryId_idx" ON "bank_feed_transactions"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_feed_transactions_companyId_providerTransactionId_key" ON "bank_feed_transactions"("companyId", "providerTransactionId");

-- CreateIndex
CREATE INDEX "webhook_events_status_receivedAt_idx" ON "webhook_events"("status", "receivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "webhook_events_provider_eventId_key" ON "webhook_events"("provider", "eventId");

-- CreateIndex
CREATE INDEX "bank_accounts_bankConnectionId_idx" ON "bank_accounts"("bankConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "bank_accounts_companyId_providerAccountId_key" ON "bank_accounts"("companyId", "providerAccountId");

-- AddForeignKey
ALTER TABLE "bank_accounts" ADD CONSTRAINT "bank_accounts_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_transactions" ADD CONSTRAINT "bank_feed_transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_transactions" ADD CONSTRAINT "bank_feed_transactions_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_transactions" ADD CONSTRAINT "bank_feed_transactions_bankAccountId_fkey" FOREIGN KEY ("bankAccountId") REFERENCES "bank_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bank_feed_transactions" ADD CONSTRAINT "bank_feed_transactions_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "webhook_events" ADD CONSTRAINT "webhook_events_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

