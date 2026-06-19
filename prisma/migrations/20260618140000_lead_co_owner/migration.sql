-- AlterTable: optional co-owner name on a lead (for document autofill)
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "coOwnerName" TEXT;
