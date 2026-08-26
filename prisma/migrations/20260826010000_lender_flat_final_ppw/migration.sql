-- Whether a partner's stated price per watt is a CEILING or the PRICE.
--
-- `maxFinalPpwCents` shipped as a ceiling: price the deal the ordinary way and
-- hold the contract down to it only when it comes out above. That is right for
-- a lender who publishes a maximum, and wrong for the partner the column was
-- built for. Amos Capital Fund's paper is a flat $5.50/W -- whatever the base a
-- rep types, whatever extra work is on the job, whatever the array comes to --
-- and a rule that only ever pushes DOWN quotes a cheaper deal cheaper than the
-- partner's own price list.
--
-- So the figure keeps its column and gains a mode. `cap` is the default and is
-- exactly what every lender does today, which is why this migration moves no
-- existing price: a company that never opens Settings sees nothing change.
--
-- The mode is meaningless on a lender with no figure set (NULL), and is ignored
-- there rather than being a third state nobody can see.

-- CreateEnum
CREATE TYPE "SolarFinalPpwMode" AS ENUM ('cap', 'flat');

-- AlterTable
ALTER TABLE "solar_lenders" ADD COLUMN "finalPpwMode" "SolarFinalPpwMode" NOT NULL DEFAULT 'cap';
