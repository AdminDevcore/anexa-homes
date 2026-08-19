-- A financing partner's own logo, held as bytes rather than hotlinked.
-- Both columns are nullable: every existing lender keeps working and simply
-- shows a monogram until somebody gives it a mark.
ALTER TABLE "solar_lenders" ADD COLUMN "logoKey" TEXT;
ALTER TABLE "solar_lenders" ADD COLUMN "logoUpdatedAt" TIMESTAMP(3);
