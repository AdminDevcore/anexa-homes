-- Nova voice assistant: append-only audit trail of every tool call.
-- Additive only: two enums and one table, no relations (the trail outlives the
-- deal and the person it names).

-- CreateEnum
CREATE TYPE "NovaToolKind" AS ENUM ('read', 'write', 'decline');

-- CreateEnum
CREATE TYPE "NovaAuditPhase" AS ENUM ('executed', 'refused', 'failed', 'proposed', 'cancelled', 'expired', 'declined');

-- CreateTable
CREATE TABLE "nova_audit_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry",
    "actorId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "kind" "NovaToolKind" NOT NULL,
    "phase" "NovaAuditPhase" NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "result" JSONB,
    "error" TEXT,
    "leadId" TEXT,
    "entityType" TEXT,
    "entityId" TEXT,
    "pendingActionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nova_audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nova_audit_events_companyId_leadId_createdAt_idx" ON "nova_audit_events"("companyId", "leadId", "createdAt");

-- CreateIndex
CREATE INDEX "nova_audit_events_companyId_actorId_createdAt_idx" ON "nova_audit_events"("companyId", "actorId", "createdAt");
