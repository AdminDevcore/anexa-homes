-- AlterTable
ALTER TABLE "files" ADD COLUMN     "transactionId" TEXT;

-- CreateIndex
CREATE INDEX "files_transactionId_idx" ON "files"("transactionId");

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
