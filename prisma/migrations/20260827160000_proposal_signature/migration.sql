-- The customer's signature on a solar proposal.
--
-- Amos Capital will not take a proposal the homeowner has not signed, and until
-- now "accepted" meant a typed name in a box and a timestamp on a row. Nothing
-- about it reached the paper: a signed proposal printed a green "thank you"
-- panel with no name, no date and no mark, so the PDF that went to the lender
-- was indistinguishable from an unsigned one.
--
-- These columns hold the mark and the record behind it — the signature image,
-- how it was made, who made it, that they consented to sign electronically
-- BEFORE they signed, and the IP and user agent that ESIGN / UETA evidence is
-- built from.
--
-- Every column is nullable and nothing is backfilled. A proposal accepted
-- before today keeps its `signedAt` and reads as exactly what it is: accepted,
-- with no mark on file.
ALTER TABLE "solar_proposals" ADD COLUMN "signatureData" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "signatureType" "SignatureType";
ALTER TABLE "solar_proposals" ADD COLUMN "signerName" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "signerEmail" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "signedIp" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "signedUserAgent" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "consentAt" TIMESTAMP(3);
ALTER TABLE "solar_proposals" ADD COLUMN "signedVia" TEXT;
ALTER TABLE "solar_proposals" ADD COLUMN "signedHostId" TEXT;
