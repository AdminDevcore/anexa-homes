-- AlterEnum
ALTER TYPE "KnockDisposition" ADD VALUE 'not_knocked';

-- DropForeignKey
ALTER TABLE "knocks" DROP CONSTRAINT "knocks_repId_fkey";

-- AlterTable
ALTER TABLE "knocks" ALTER COLUMN "repId" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "knocks_companyId_lat_lng_idx" ON "knocks"("companyId", "lat", "lng");

-- AddForeignKey
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_repId_fkey" FOREIGN KEY ("repId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
