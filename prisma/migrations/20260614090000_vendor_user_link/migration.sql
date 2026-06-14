-- AlterTable
ALTER TABLE "bookkeeping_vendors" ADD COLUMN "userId" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "bookkeeping_vendors_userId_key" ON "bookkeeping_vendors"("userId");
