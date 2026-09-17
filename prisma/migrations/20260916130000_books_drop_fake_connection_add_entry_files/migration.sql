-- AlterTable
ALTER TABLE "company_settings" DROP COLUMN "bookkeepingApiKey",
DROP COLUMN "bookkeepingProvider";

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "journalEntryId" TEXT;

-- AddForeignKey
ALTER TABLE "files" ADD CONSTRAINT "files_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "journal_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

