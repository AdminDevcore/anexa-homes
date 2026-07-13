-- AlterTable
ALTER TABLE "cash_bids" ADD COLUMN     "carrier" TEXT,
ADD COLUMN     "claimNumber" TEXT,
ADD COLUMN     "deductibleCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'cash';
