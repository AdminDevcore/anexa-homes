-- CreateEnum
CREATE TYPE "SolarSystemType" AS ENUM ('pv', 'pv_storage', 'storage');

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "solarRedlinePerBatteryCents" INTEGER;

-- AlterTable
ALTER TABLE "solar_designs" ADD COLUMN     "systemType" "SolarSystemType" NOT NULL DEFAULT 'pv_storage',
ADD COLUMN     "touOffPeakRateMills" INTEGER,
ADD COLUMN     "touPeakRateMills" INTEGER;

-- AlterTable
ALTER TABLE "solar_finance" ADD COLUMN     "stickerPricePerBatteryCents" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "solar_lender_products" ADD COLUMN     "financesStorageOnly" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN     "finalBatteryPriceMode" "SolarFinalPpwMode" NOT NULL DEFAULT 'cap',
ADD COLUMN     "maxFinalPricePerBatteryCents" INTEGER,
ADD COLUMN     "minBasePricePerBatteryCents" INTEGER;

-- AlterTable
ALTER TABLE "solar_providers" ADD COLUMN     "touOffPeakRateMills" INTEGER,
ADD COLUMN     "touPeakRateMills" INTEGER,
ADD COLUMN     "touPeakWindow" TEXT;

-- AlterTable
ALTER TABLE "solar_settings" ADD COLUMN     "touCyclesPerDay" DOUBLE PRECISION NOT NULL DEFAULT 1,
ADD COLUMN     "touPeakSharePct" DOUBLE PRECISION NOT NULL DEFAULT 30,
ADD COLUMN     "touRoundTripEfficiency" DOUBLE PRECISION NOT NULL DEFAULT 90;

-- AlterTable
ALTER TABLE "users" ADD COLUMN     "solarRedlinePerBatteryCents" INTEGER;

-- CreateTable
CREATE TABLE "solar_backup_profiles" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "name" TEXT NOT NULL,
    "loadWatts" INTEGER NOT NULL,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_backup_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_rebates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "name" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "perBattery" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "rank" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_rebates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_deal_rebates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "rebateId" TEXT NOT NULL,
    "qty" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_deal_rebates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solar_backup_profiles_companyId_isActive_idx" ON "solar_backup_profiles"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "solar_backup_profiles_companyId_name_key" ON "solar_backup_profiles"("companyId", "name");

-- CreateIndex
CREATE INDEX "solar_rebates_companyId_isActive_idx" ON "solar_rebates"("companyId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "solar_rebates_companyId_name_key" ON "solar_rebates"("companyId", "name");

-- CreateIndex
CREATE INDEX "solar_deal_rebates_companyId_leadId_idx" ON "solar_deal_rebates"("companyId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "solar_deal_rebates_leadId_rebateId_key" ON "solar_deal_rebates"("leadId", "rebateId");

-- AddForeignKey
ALTER TABLE "solar_backup_profiles" ADD CONSTRAINT "solar_backup_profiles_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_rebates" ADD CONSTRAINT "solar_rebates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_deal_rebates" ADD CONSTRAINT "solar_deal_rebates_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_deal_rebates" ADD CONSTRAINT "solar_deal_rebates_rebateId_fkey" FOREIGN KEY ("rebateId") REFERENCES "solar_rebates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------
-- Backfill: every design describes itself from what is already on the row.
--
-- The column defaults to 'pv_storage', which is right for a NEW design and
-- wrong as a blanket answer for history: it would relabel every panels-only
-- deal ever sold as carrying a battery. The row already knows, so ask it.
-- ---------------------------------------------------------------------------
UPDATE "solar_designs" SET "systemType" = 'pv_storage' WHERE "batteryId" IS NOT NULL;
UPDATE "solar_designs" SET "systemType" = 'pv'         WHERE "batteryId" IS NULL;

-- ---------------------------------------------------------------------------
-- Seed: the three backup profiles every company starts with.
--
-- Backup hours are DERIVED from these, so a company with none cannot state an
-- hours figure at all -- the proposal omits the chapter and readiness blocks.
-- Shipping them with the migration means the feature works the day it lands
-- rather than the day somebody finds the settings screen.
--
-- Rank order is load-bearing: the customer's cover headlines rank 0.
-- ---------------------------------------------------------------------------
INSERT INTO "solar_backup_profiles"
       ("id", "companyId", "vertical", "name", "loadWatts", "rank", "isActive", "createdAt", "updatedAt")
SELECT gen_random_uuid(), c."id", 'solar', p.name, p.watts, p.rank, true, now(), now()
  FROM "companies" c
 CROSS JOIN (VALUES
        ('Essentials',      1000, 0),
        ('Essentials + AC', 3500, 1),
        ('Whole home',      5000, 2)
       ) AS p(name, watts, rank)
    ON CONFLICT ("companyId", "name") DO NOTHING;
