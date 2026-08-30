-- The contract value and the customer's obligation stop being the same number.
--
-- Until now they were one column. `solar_finance.contractPriceCents` is what the
-- customer signs AND what the lender's paper is written for, because on every
-- partner this company sells they are the same figure. A prepaid-lease programme
-- like Participate cannot be said that way:
--
--     customer obligation   $48,400   -- 8.80 kW at the quoted $5.50/W
--   + programme adjustment  $70,000   -- this partner's fixed contribution
--   = contract value       $118,400
--
-- The homeowner is liable for $48,400 and nothing else. Their payment, their
-- savings, their payback and their price per watt are all worked out from it.
-- The $118,400 is the funder's number and appears only where the document says
-- so, on its own reconciliation.
--
-- NOTHING IS RE-PRICED HERE. `contractAdjustmentEnabled` is FALSE on every
-- existing row, so every lender in the database keeps quoting exactly what it
-- quotes today, and no proposal already generated is touched at all -- those are
-- frozen snapshots and this migration does not read them.
--
-- The label and the disclosure are deliberately NOT defaulted. Naming somebody
-- else's money is a legal characterisation -- "contribution" and "discount" are
-- not the same claim -- so the app ships no wording and generation is blocked
-- until an admin has stated the approved term for this programme.

-- CreateEnum
CREATE TYPE "SolarContractAdjustmentType" AS ENUM ('fixed');

-- AlterTable
ALTER TABLE "solar_lenders"
  ADD COLUMN     "contractAdjustmentEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN     "contractAdjustmentType" "SolarContractAdjustmentType" NOT NULL DEFAULT 'fixed',
  ADD COLUMN     "contractAdjustmentCents" INTEGER,
  ADD COLUMN     "contractAdjustmentLabel" TEXT,
  ADD COLUMN     "contractAdjustmentDisclosure" TEXT,
  ADD COLUMN     "contractAdjustmentEffectiveAt" TIMESTAMP(3),
  ADD COLUMN     "ownershipDisclosure" TEXT;
