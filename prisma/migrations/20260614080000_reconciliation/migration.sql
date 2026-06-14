-- AlterTable
ALTER TABLE "transactions" ADD COLUMN "reconciledAt" TIMESTAMP(3);
ALTER TABLE "transactions" ADD COLUMN "reconciliationId" TEXT;

-- CreateTable
CREATE TABLE "reconciliations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "account" TEXT NOT NULL,
    "statementDate" TIMESTAMP(3) NOT NULL,
    "endingBalanceCents" INTEGER NOT NULL,
    "beginningBalanceCents" INTEGER NOT NULL,
    "clearedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reconciliations_companyId_account_idx" ON "reconciliations"("companyId", "account");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciliationId_fkey" FOREIGN KEY ("reconciliationId") REFERENCES "reconciliations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
