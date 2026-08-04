-- Claim status becomes a per-company customizable list instead of a fixed enum.
--
-- Written by hand: `prisma migrate dev` wanted to DROP and recreate both columns,
-- which would have wiped every deal's claim status. `ALTER ... TYPE TEXT USING`
-- keeps the values byte-for-byte — the nine enum labels simply become the nine
-- built-in keys in src/lib/claim-status.ts.

-- leads.claimStatus: enum -> text
ALTER TABLE "leads" ALTER COLUMN "claimStatus" DROP DEFAULT;
ALTER TABLE "leads" ALTER COLUMN "claimStatus" TYPE TEXT USING "claimStatus"::TEXT;
ALTER TABLE "leads" ALTER COLUMN "claimStatus" SET DEFAULT 'not_filed';

-- claims.status: enum -> text
ALTER TABLE "claims" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "claims" ALTER COLUMN "status" TYPE TEXT USING "status"::TEXT;
ALTER TABLE "claims" ALTER COLUMN "status" SET DEFAULT 'filed';

-- Nothing references the enum type any more.
DROP TYPE "ClaimStatus";

-- The company's editable list: JSON array of { key, label }. Empty = code defaults.
ALTER TABLE "company_settings" ADD COLUMN "claimStatuses" JSONB NOT NULL DEFAULT '[]';
