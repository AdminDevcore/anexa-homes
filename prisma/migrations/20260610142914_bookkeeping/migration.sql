ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "bookkeepingProvider" TEXT;
ALTER TABLE "company_settings" ADD COLUMN IF NOT EXISTS "bookkeepingApiKey" TEXT;

CREATE TABLE IF NOT EXISTS "bookkeeping_categories" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'expense',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookkeeping_categories_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bookkeeping_categories_companyId_type_idx" ON "bookkeeping_categories"("companyId", "type");

CREATE TABLE IF NOT EXISTS "transactions" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "date" TIMESTAMP(3) NOT NULL,
  "description" TEXT NOT NULL,
  "amountCents" INTEGER NOT NULL,
  "vendor" TEXT,
  "account" TEXT,
  "categoryId" TEXT,
  "projectId" TEXT,
  "invoiceId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'uncategorized',
  "source" TEXT NOT NULL DEFAULT 'manual',
  "externalId" TEXT,
  "notes" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "transactions_companyId_date_idx" ON "transactions"("companyId", "date");
CREATE INDEX IF NOT EXISTS "transactions_companyId_categoryId_idx" ON "transactions"("companyId", "categoryId");

DO $$ BEGIN
  ALTER TABLE "bookkeeping_categories" ADD CONSTRAINT "bookkeeping_categories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
DO $$ BEGIN
  ALTER TABLE "transactions" ADD CONSTRAINT "transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "bookkeeping_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
