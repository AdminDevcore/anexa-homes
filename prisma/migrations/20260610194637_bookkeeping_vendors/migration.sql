CREATE TABLE IF NOT EXISTS "bookkeeping_vendors" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "bookkeeping_vendors_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "bookkeeping_vendors_companyId_idx" ON "bookkeeping_vendors"("companyId");
DO $$ BEGIN
  ALTER TABLE "bookkeeping_vendors" ADD CONSTRAINT "bookkeeping_vendors_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;
