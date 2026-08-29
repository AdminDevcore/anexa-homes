-- Two rules that belonged to the lender and were living somewhere else.
--
-- 1. WHICH ADDERS RIDE ON TOP OF A PARTNER'S PRICE. `solar_equipment
--    .financedOnTop` answered that once, for every lender at the same time,
--    because when it shipped exactly one partner priced this way -- Amos
--    Capital Fund funds a flat $5.50/W and a roof above it at cost. A second
--    capped partner that disagrees about the roof has nowhere to say so. The
--    new join table is the per-lender override; the catalogue column stays as
--    the fallback for every pair nobody has ruled on.
--
-- 2. WHETHER THE PARTNER FUNDS AN ARRAY WITH NO BATTERY. The app held one
--    opinion for everybody and no admin could change it.
--
-- Nothing is re-priced or re-gated here. `batteryRule` defaults to 'warn',
-- which is precisely what every lender did before the column existed, and the
-- override table starts empty, so every adder keeps answering to the catalogue
-- until somebody opens a lender and decides otherwise.

-- CreateEnum
CREATE TYPE "SolarLenderBatteryRule" AS ENUM ('optional', 'warn', 'required');

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN     "batteryRule" "SolarLenderBatteryRule" NOT NULL DEFAULT 'warn';

-- CreateTable
CREATE TABLE "solar_lender_adder_rules" (
    "lenderId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "financedOnTop" BOOLEAN NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_lender_adder_rules_pkey" PRIMARY KEY ("lenderId","equipmentId")
);

-- CreateIndex
CREATE INDEX "solar_lender_adder_rules_equipmentId_idx" ON "solar_lender_adder_rules"("equipmentId");

-- AddForeignKey
ALTER TABLE "solar_lender_adder_rules" ADD CONSTRAINT "solar_lender_adder_rules_lenderId_fkey" FOREIGN KEY ("lenderId") REFERENCES "solar_lenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_lender_adder_rules" ADD CONSTRAINT "solar_lender_adder_rules_equipmentId_fkey" FOREIGN KEY ("equipmentId") REFERENCES "solar_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
