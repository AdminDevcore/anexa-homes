-- AlterTable: pipeline stage SLA settings
ALTER TABLE "pipeline_stages" ADD COLUMN "targetDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pipeline_stages" ADD COLUMN "escalationDays" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "pipeline_stages" ADD COLUMN "notificationRecipient" TEXT NOT NULL DEFAULT 'none';
ALTER TABLE "pipeline_stages" ADD COLUMN "sendInApp" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "pipeline_stages" ADD COLUMN "sendEmail" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "pipeline_stages" ADD COLUMN "markOverdue" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: lead SLA tracking
ALTER TABLE "leads" ADD COLUMN "stageAlertLevel" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "leads" ADD COLUMN "stageOverdue" BOOLEAN NOT NULL DEFAULT false;

-- Backfill stage entry time so day-in-stage is meaningful for existing leads.
UPDATE "leads" SET "stageChangedAt" = "createdAt" WHERE "stageChangedAt" IS NULL;
