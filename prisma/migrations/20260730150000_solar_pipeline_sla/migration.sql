-- ===========================================================================
-- Solar pipeline: stage types, owner roles, blocker parties, crossover (Phase 3)
--
-- Purely additive. Every existing roofing stage defaults to
-- stageType='internally_owned' with no ownerRole and followUpDays=0, which is
-- exactly the behaviour it had before, so the live roofing pipeline is
-- untouched.
--
-- Why two stage types: we control when an internally-owned stage completes, so
-- it gets a hard deadline. We do not control an AHJ's plan review or a utility's
-- PTO queue, so those get a follow-up cadence measured from OUR last touch.
-- Flagging our team for a utility's delay is how a backlog becomes noise.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "StageType" AS ENUM ('internally_owned', 'externally_blocked');

-- CreateEnum
CREATE TYPE "BlockerParty" AS ENUM ('us', 'ahj', 'utility', 'customer', 'lender');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "blockedBy" "BlockerParty",
ADD COLUMN     "blockerNote" TEXT,
ADD COLUMN     "lastChaseAlertAt" TIMESTAMP(3),
ADD COLUMN     "lastTouchAt" TIMESTAMP(3),
ADD COLUMN     "linkedDealId" TEXT,
ADD COLUMN     "needsMpu" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "needsReroof" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "pipeline_stages" ADD COLUMN     "defaultBlocker" "BlockerParty",
ADD COLUMN     "followUpDays" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "isActionRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "ownerRole" TEXT,
ADD COLUMN     "stageType" "StageType" NOT NULL DEFAULT 'internally_owned';

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_linkedDealId_fkey" FOREIGN KEY ("linkedDealId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

