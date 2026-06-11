-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "deductibleCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "supplementCents" INTEGER NOT NULL DEFAULT 0;
