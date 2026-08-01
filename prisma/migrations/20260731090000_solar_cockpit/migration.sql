-- ===========================================================================
-- Solar project cockpit (Part B)
--
-- Purely additive: two enums, two tables.
--
-- These are the only two things the cockpit needed that we did NOT already
-- capture. Everything else on the new deal detail — the pricing breakdown,
-- system specs, document folders — is surfacing data Phase 4 already stores.
--
--   solar_milestones  — WHEN the money arrives. Commission tranches (M1/M2/M3)
--                       and financier draws (1st/2nd/3rd) pay against events
--                       like contract, install and PTO. We stored the amounts
--                       implicitly but never the schedule.
--   deal_feed_posts   — ActivityLog records SYSTEM events with no audience and
--                       no way to address a colleague. Posts add a channel
--                       (external / internal / customer) so internal chatter
--                       cannot leak to the homeowner, plus @mentions.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

-- CreateEnum
CREATE TYPE "MilestonePayee" AS ENUM ('rep', 'financier');

-- CreateEnum
CREATE TYPE "FeedChannel" AS ENUM ('external', 'internal', 'customer');

-- CreateTable
CREATE TABLE "solar_milestones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "payee" "MilestonePayee" NOT NULL,
    "sequence" INTEGER NOT NULL,
    "label" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL DEFAULT 0,
    "trigger" TEXT,
    "expectedAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_milestones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "deal_feed_posts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'roofing',
    "leadId" TEXT NOT NULL,
    "channel" "FeedChannel" NOT NULL DEFAULT 'internal',
    "body" TEXT NOT NULL,
    "authorId" TEXT,
    "mentions" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "deal_feed_posts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "solar_milestones_companyId_leadId_idx" ON "solar_milestones"("companyId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "solar_milestones_leadId_payee_sequence_key" ON "solar_milestones"("leadId", "payee", "sequence");

-- CreateIndex
CREATE INDEX "deal_feed_posts_companyId_leadId_createdAt_idx" ON "deal_feed_posts"("companyId", "leadId", "createdAt");

-- AddForeignKey
ALTER TABLE "solar_milestones" ADD CONSTRAINT "solar_milestones_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_milestones" ADD CONSTRAINT "solar_milestones_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_feed_posts" ADD CONSTRAINT "deal_feed_posts_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_feed_posts" ADD CONSTRAINT "deal_feed_posts_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "deal_feed_posts" ADD CONSTRAINT "deal_feed_posts_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

