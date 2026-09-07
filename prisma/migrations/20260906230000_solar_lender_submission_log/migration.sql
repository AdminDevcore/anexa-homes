-- Every attempt to file a deal with a partner lender, request and answer.
--
-- Until now the only record a submission left inside the product was a one-line
-- error string on the activity log; the payload and the lender's own response
-- went to `console.error` and nowhere a human could reach. Diagnosing the two
-- refusals on 2026-09-05 and 06 meant decrypting the lender's API key and
-- replaying the request by hand against their API.
--
-- Additive and write-only: nothing reads this to make a decision, so a row that
-- fails to write can never cost an application.
CREATE TABLE "solar_lender_submissions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "lenderId" TEXT,
    "lenderName" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    -- The exact body that crossed the wire. The API key is not in it and cannot
    -- be: it travels as a header, and this is written from the payload object.
    "request" JSONB NOT NULL,
    "ok" BOOLEAN NOT NULL,
    "status" INTEGER,
    "code" TEXT,
    "message" TEXT,
    "referenceNumber" TEXT,
    "applicationId" TEXT,
    "actorName" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_lender_submissions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "solar_lender_submissions_companyId_leadId_createdAt_idx"
    ON "solar_lender_submissions"("companyId", "leadId", "createdAt");

ALTER TABLE "solar_lender_submissions" ADD CONSTRAINT "solar_lender_submissions_companyId_fkey"
    FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_lender_submissions" ADD CONSTRAINT "solar_lender_submissions_leadId_fkey"
    FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
