-- CreateEnum
CREATE TYPE "CashBidStatus" AS ENUM ('draft', 'sent', 'signed');

-- CreateTable
CREATE TABLE "cash_bids" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "createdById" TEXT,
    "workDescription" TEXT NOT NULL,
    "totalCents" INTEGER NOT NULL DEFAULT 0,
    "depositPercent" INTEGER NOT NULL DEFAULT 50,
    "status" "CashBidStatus" NOT NULL DEFAULT 'draft',
    "signerName" TEXT,
    "signerIp" TEXT,
    "signedAt" TIMESTAMP(3),
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "cash_bids_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "cash_bids_token_key" ON "cash_bids"("token");

-- CreateIndex
CREATE INDEX "cash_bids_companyId_leadId_idx" ON "cash_bids"("companyId", "leadId");
