-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN     "inspectionOutcomes" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "qcChecklistTemplate" JSONB NOT NULL DEFAULT '[]';
