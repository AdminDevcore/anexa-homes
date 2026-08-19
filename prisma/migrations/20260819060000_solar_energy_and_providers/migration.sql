CREATE TYPE "SolarProviderKind" AS ENUM ('utility', 'retail');

CREATE TABLE "solar_providers" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "kind" "SolarProviderKind" NOT NULL,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "solar_providers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "solar_providers_companyId_kind_name_key" ON "solar_providers"("companyId", "kind", "name");
CREATE INDEX "solar_providers_companyId_kind_active_idx" ON "solar_providers"("companyId", "kind", "active");

ALTER TABLE "solar_providers" ADD CONSTRAINT "solar_providers_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- The retailer that bills the customer, the rate a rep was told, and which of
-- the two entry methods the Energy step was filled in with.
ALTER TABLE "solar_designs" ADD COLUMN "electricProvider" TEXT;
ALTER TABLE "solar_designs" ADD COLUMN "utilityRateMills" INTEGER;
ALTER TABLE "solar_designs" ADD COLUMN "usageBasis" TEXT;

-- What a system is sized toward. 100 = cover the whole bill.
ALTER TABLE "solar_settings" ADD COLUMN "targetOffsetPct" DOUBLE PRECISION NOT NULL DEFAULT 100;
