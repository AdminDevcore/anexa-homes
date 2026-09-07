-- WHICH FIGURE A PARTNER UNDERWRITES, AND WHAT IT MEANS BY A SAVING.
--
-- A priced solar deal carries several defensible amounts and they can differ by
-- six figures: the contract value a partner's paper is written at, the
-- household's own obligation, and the contract value less the federal credits.
-- Until now the choice was hard-coded, so an admin who wanted to know what was
-- being sent had no way to look and no way to change it.
--
-- BOTH DEFAULT TO TODAY'S BEHAVIOUR, so this migration re-maps nothing: every
-- existing lender keeps sending the contract value and the utility bill
-- avoided, which is exactly what they sent yesterday.
CREATE TYPE "SolarSubmissionAmountBasis" AS ENUM ('contract_value', 'customer_obligation', 'after_credits');
CREATE TYPE "SolarSubmissionSavingBasis" AS ENUM ('utility_avoided', 'net_of_payment');

ALTER TABLE "solar_lenders"
  ADD COLUMN "submissionAmountBasis" "SolarSubmissionAmountBasis" NOT NULL DEFAULT 'contract_value',
  ADD COLUMN "submissionSavingBasis" "SolarSubmissionSavingBasis" NOT NULL DEFAULT 'utility_avoided';

-- Which basis actually produced the amount on a given attempt. Recorded rather
-- than inferred from the lender row, because that row can be changed afterwards
-- and "what did we ask them to fund, and on what basis" has to stay answerable.
ALTER TABLE "solar_lender_submissions" ADD COLUMN "amountBasis" TEXT;
