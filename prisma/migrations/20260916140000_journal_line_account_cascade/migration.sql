-- DropForeignKey
ALTER TABLE "journal_lines" DROP CONSTRAINT "journal_lines_accountId_fkey";

-- AddForeignKey
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "ledger_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

