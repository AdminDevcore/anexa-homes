-- Drop the lender Disclosures tab: the contract adjustment and the ownership
-- wording.
--
-- The contract adjustment was the one place in this application where a
-- partner's contract value and the customer's obligation were different
-- numbers — a prepaid-lease programme whose paper is written for more than the
-- household owes. No partner was ever configured to run one: every lender row
-- is at the default (contractAdjustmentEnabled = false, every other column
-- NULL), and no proposal snapshot carries a `lenderAdjustment` block. So this
-- drops storage, not data, and no generated document changes.
--
-- The federal credit ladder that shipped alongside it STAYS. It is quoted on
-- every purchase proposal now and has nothing to do with a partner programme.
ALTER TABLE "solar_lenders"
  DROP COLUMN IF EXISTS "contractAdjustmentEnabled",
  DROP COLUMN IF EXISTS "contractAdjustmentType",
  DROP COLUMN IF EXISTS "contractAdjustmentCents",
  DROP COLUMN IF EXISTS "contractAdjustmentLabel",
  DROP COLUMN IF EXISTS "contractAdjustmentDisclosure",
  DROP COLUMN IF EXISTS "contractAdjustmentEffectiveAt",
  DROP COLUMN IF EXISTS "ownershipDisclosure";

DROP TYPE IF EXISTS "SolarContractAdjustmentType";
