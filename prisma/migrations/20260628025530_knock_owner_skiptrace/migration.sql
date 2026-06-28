-- AlterTable
ALTER TABLE "knocks" ADD COLUMN     "ownerData" JSONB,
ADD COLUMN     "ownerLookedUpAt" TIMESTAMP(3),
ADD COLUMN     "ownerSource" TEXT;
