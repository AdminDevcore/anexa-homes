-- ===========================================================================
-- Versioned solar proposals + audit trail (Phase 5)
--
-- Purely additive: two new tables.
--
-- The snapshot column is the design point: every figure a homeowner sees is
-- frozen at generation time, so changing an assumption later cannot rewrite
-- what a customer was already shown. Versions supersede rather than overwrite.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

-- CreateTable
CREATE TABLE "solar_proposals" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL DEFAULT 'solar',
    "leadId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ProposalStatus" NOT NULL DEFAULT 'draft',
    "publicToken" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "supersededAt" TIMESTAMP(3),
    "documentPackageId" TEXT,
    "createdById" TEXT,
    "sentAt" TIMESTAMP(3),
    "viewedAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "solar_proposal_events" (
    "id" TEXT NOT NULL,
    "proposalId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actorId" TEXT,
    "actorName" TEXT,
    "ip" TEXT,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "solar_proposal_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solar_proposals_publicToken_key" ON "solar_proposals"("publicToken");

-- CreateIndex
CREATE INDEX "solar_proposals_companyId_leadId_idx" ON "solar_proposals"("companyId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "solar_proposals_leadId_version_key" ON "solar_proposals"("leadId", "version");

-- CreateIndex
CREATE INDEX "solar_proposal_events_proposalId_createdAt_idx" ON "solar_proposal_events"("proposalId", "createdAt");

-- AddForeignKey
ALTER TABLE "solar_proposals" ADD CONSTRAINT "solar_proposals_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_proposals" ADD CONSTRAINT "solar_proposals_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "solar_proposal_events" ADD CONSTRAINT "solar_proposal_events_proposalId_fkey" FOREIGN KEY ("proposalId") REFERENCES "solar_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

