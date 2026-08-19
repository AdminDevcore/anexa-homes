-- Lender finance products: the terms a lender will actually finance on.
--
-- Solar only. One new table plus two nullable columns. Additive throughout:
-- nothing existing is altered or dropped, every new column is nullable with no
-- backfill, and a rollback is DROP TABLE / DROP COLUMN. Roofing reads none of
-- this, and a company that adds no products behaves exactly as it does today.

-- One sellable set of terms. A rate sheet is a list of these: 25 years at 4.99%
-- costs an 18% dealer fee, the same term at 3.99% costs 28%. Each combination
-- is separately sellable and separately priced, so each is a row.
--
-- Per-product columns are nullable because which ones a row must carry depends
-- on `product`, and that is enforced where rows are written. Same shape as
-- solar_finance, which holds the same four products the same way.
CREATE TABLE IF NOT EXISTS "solar_lender_products" (
  "id"        TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "vertical"  "Industry" NOT NULL DEFAULT 'solar',
  "lenderId"  TEXT NOT NULL,
  "product"   "FinanceProduct" NOT NULL,
  "name"      TEXT,

  -- Loan
  "aprPct"       DOUBLE PRECISION,
  "termMonths"   INTEGER,
  "dealerFeePct" DOUBLE PRECISION,

  -- Lease: price per kW-DC per month, cents
  "leaseRateCentsPerKwMonth" INTEGER,

  -- PPA: price per kWh in mills (tenths of a cent)
  "rateMillsPerKwh" INTEGER,

  -- Lease & PPA
  "escalatorPct" DOUBLE PRECISION,
  "termYears"    INTEGER,

  "isActive"  BOOLEAN NOT NULL DEFAULT true,
  "rank"      INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solar_lender_products_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "solar_lender_products"
  ADD CONSTRAINT "solar_lender_products_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON UPDATE CASCADE ON DELETE CASCADE;

-- Deleting a lender takes its rate sheet with it. The products describe that
-- lender's money and mean nothing without it — unlike a DESIGN built for the
-- lender, which stays and simply loses the pointer.
ALTER TABLE "solar_lender_products"
  ADD CONSTRAINT "solar_lender_products_lenderId_fkey"
  FOREIGN KEY ("lenderId") REFERENCES "solar_lenders"("id") ON UPDATE CASCADE ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS "solar_lender_products_companyId_isActive_idx"
  ON "solar_lender_products" ("companyId", "isActive");

-- The step-2 picker's query: this lender, this finance product, still sellable.
CREATE INDEX IF NOT EXISTS "solar_lender_products_lenderId_product_isActive_idx"
  ON "solar_lender_products" ("lenderId", "product", "isActive");

-- Which product a deal was quoted from. Provenance only: the terms themselves
-- are copied onto solar_finance when the rep picks it, so editing next
-- quarter's rate sheet cannot re-term a proposal a customer already signed.
--
-- ON DELETE SET NULL rather than CASCADE, for the obvious reason: removing a
-- product must never delete a customer's financing.
ALTER TABLE "solar_finance"
  ADD COLUMN IF NOT EXISTS "lenderProductId" TEXT;

ALTER TABLE "solar_finance"
  ADD CONSTRAINT "solar_finance_lenderProductId_fkey"
  FOREIGN KEY ("lenderProductId") REFERENCES "solar_lender_products"("id") ON UPDATE CASCADE ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS "solar_finance_lenderProductId_idx"
  ON "solar_finance" ("lenderProductId");

-- What the company must keep per watt after the lender's cut, cents.
--
-- NULL is meaningful and is the default: derive nothing, leave the sticker
-- exactly as the rep typed it. That is how every existing company behaves, so
-- this migration changes no pricing anywhere until somebody sets a target.
ALTER TABLE "solar_settings"
  ADD COLUMN IF NOT EXISTS "targetNetPpwCents" INTEGER;
