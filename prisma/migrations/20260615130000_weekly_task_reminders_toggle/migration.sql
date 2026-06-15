-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "weeklyTaskRemindersEnabled" BOOLEAN NOT NULL DEFAULT true;
