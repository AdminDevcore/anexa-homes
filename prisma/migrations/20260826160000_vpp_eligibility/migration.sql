-- Who a provider's VPP programme is actually open to.
--
-- A VPP runs on SOME ways of paying and SOME hardware. Three axes, ANDed, each
-- EMPTY BY DEFAULT AND MEANING "NO RESTRICTION" when empty — so this migration
-- changes nothing anybody sees until an office fills a list in.
--
-- The finance-type list is a column rather than a fourth table because cash has
-- no lender row to join to: a list of named products can never say "a cash deal
-- qualifies", and that is the commonest answer these programmes give.
ALTER TABLE "solar_providers"
  ADD COLUMN "vppFinanceProducts" "FinanceProduct"[] DEFAULT ARRAY[]::"FinanceProduct"[];

-- Which batteries the programme will enrol. Explicit join, like
-- solar_equipment_lenders, so an approval can carry its own facts later.
CREATE TABLE "solar_provider_vpp_equipment" (
    "providerId" TEXT NOT NULL,
    "equipmentId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_provider_vpp_equipment_pkey" PRIMARY KEY ("providerId","equipmentId")
);

CREATE INDEX "solar_provider_vpp_equipment_equipmentId_idx" ON "solar_provider_vpp_equipment"("equipmentId");

ALTER TABLE "solar_provider_vpp_equipment"
  ADD CONSTRAINT "solar_provider_vpp_equipment_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "solar_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_provider_vpp_equipment"
  ADD CONSTRAINT "solar_provider_vpp_equipment_equipmentId_fkey"
  FOREIGN KEY ("equipmentId") REFERENCES "solar_equipment"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Which named finance products it accepts. NARROWS the type list above rather
-- than replacing it.
CREATE TABLE "solar_provider_vpp_products" (
    "providerId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_provider_vpp_products_pkey" PRIMARY KEY ("providerId","productId")
);

CREATE INDEX "solar_provider_vpp_products_productId_idx" ON "solar_provider_vpp_products"("productId");

ALTER TABLE "solar_provider_vpp_products"
  ADD CONSTRAINT "solar_provider_vpp_products_providerId_fkey"
  FOREIGN KEY ("providerId") REFERENCES "solar_providers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "solar_provider_vpp_products"
  ADD CONSTRAINT "solar_provider_vpp_products_productId_fkey"
  FOREIGN KEY ("productId") REFERENCES "solar_lender_products"("id") ON DELETE CASCADE ON UPDATE CASCADE;
