-- THREE MORE PLACES A PARTNER, NOT A CONSTANT, DECIDES WHAT IS SENT.
--
-- The Submission tab already published the whole mapping and let an admin
-- choose two of it: which figure is the loan amount, and what a saving means.
-- The rest of the table was stated as fixed. Three of those rows were not
-- actually fixed facts — they were choices the code had made silently, and on
-- each of them more than one answer is true:
--
--   the saving's YEAR   `years[0]` was hard-coded. The comparison runs for the
--                       life of the loan and the utility side escalates, so
--                       year one is the smallest of thirty true answers.
--   the SELLER's name   the deal's rep, falling back to whoever pressed the
--                       button. A partner that registers one dealer contact
--                       was being sent a name it does not recognise.
--   the completion LINK `in_person` at both call sites and reachable from
--                       neither, on a column their API has always accepted.
--
-- ALL THREE DEFAULT TO TODAY'S BEHAVIOUR, so this migration re-maps nothing.
CREATE TYPE "SolarSubmissionSavingHorizon" AS ENUM ('year_one', 'term_average');
CREATE TYPE "SolarSubmissionRepNameBasis" AS ENUM ('deal_rep', 'submitter', 'fixed');
CREATE TYPE "SolarSubmissionDelivery" AS ENUM ('in_person', 'customer');

ALTER TABLE "solar_lenders"
  ADD COLUMN "submissionSavingHorizon" "SolarSubmissionSavingHorizon" NOT NULL DEFAULT 'year_one',
  ADD COLUMN "submissionRepNameBasis" "SolarSubmissionRepNameBasis" NOT NULL DEFAULT 'deal_rep',
  ADD COLUMN "submissionRepName" TEXT,
  ADD COLUMN "submissionDelivery" "SolarSubmissionDelivery" NOT NULL DEFAULT 'in_person';

-- Which saving an attempt was told, as "basis/horizon". Recorded for the same
-- reason "amountBasis" is: the body carries the figure, but the settings that
-- produced it can be changed afterwards, and $2,900 a year means two different
-- things depending on which year it describes.
ALTER TABLE "solar_lender_submissions" ADD COLUMN "savingBasis" TEXT;
