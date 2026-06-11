CREATE TABLE IF NOT EXISTS "user_onboarding" (
  "id" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "legalFirstName" TEXT, "legalMiddleName" TEXT, "legalLastName" TEXT,
  "dateOfBirth" TIMESTAMP(3),
  "ssnEnc" TEXT, "ssnLast4" TEXT,
  "address" TEXT, "city" TEXT, "state" TEXT, "zip" TEXT,
  "bankName" TEXT, "routingNumber" TEXT, "accountEnc" TEXT, "accountLast4" TEXT, "accountType" TEXT,
  "taxClassification" TEXT, "businessName" TEXT, "einEnc" TEXT, "einLast4" TEXT,
  "signatureName" TEXT, "signedAt" TIMESTAMP(3),
  "idPhotoFileId" TEXT, "ssnCardFileId" TEXT, "voidedCheckFileId" TEXT,
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "user_onboarding_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "user_onboarding_userId_key" ON "user_onboarding"("userId");
DO $$ BEGIN
  ALTER TABLE "user_onboarding" ADD CONSTRAINT "user_onboarding_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
-- Backfill: mark existing users as already onboarded so they aren't forced through the wizard.
INSERT INTO "user_onboarding" ("id", "userId", "completedAt", "createdAt", "updatedAt")
SELECT gen_random_uuid(), u."id", now(), now(), now() FROM "users" u
WHERE NOT EXISTS (SELECT 1 FROM "user_onboarding" o WHERE o."userId" = u."id");
