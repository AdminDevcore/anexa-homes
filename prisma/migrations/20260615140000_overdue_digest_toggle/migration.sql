-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "overdueDigestEnabled" BOOLEAN NOT NULL DEFAULT true;
