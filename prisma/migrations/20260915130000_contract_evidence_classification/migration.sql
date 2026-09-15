-- Contract Signed evidence: an explicit classification, never a folder alone.
-- Additive only: one enum value, one new enum, three nullable columns. Nothing
-- is backfilled — a template becomes the solar contract, and a PDF the lender's
-- signed contract, only when a person says so.

-- AlterEnum
ALTER TYPE "DocumentTemplateType" ADD VALUE 'solar_contract';

-- CreateEnum
CREATE TYPE "FileDocumentType" AS ENUM ('signed_lender_contract');

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "documentType" "FileDocumentType",
ADD COLUMN     "documentTypeSetAt" TIMESTAMP(3),
ADD COLUMN     "documentTypeSetById" TEXT;
