-- AlterTable: capture signer geolocation at signing
ALTER TABLE "document_signers" ADD COLUMN "latitude" DOUBLE PRECISION;
ALTER TABLE "document_signers" ADD COLUMN "longitude" DOUBLE PRECISION;
ALTER TABLE "document_signers" ADD COLUMN "geoAccuracy" DOUBLE PRECISION;
