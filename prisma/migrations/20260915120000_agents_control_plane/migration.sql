-- CreateEnum
CREATE TYPE "AgentDepartment" AS ENUM ('permit', 'operations', 'accounting', 'sales_escalation');

-- CreateEnum
CREATE TYPE "AgentRunTrigger" AS ENUM ('scheduled', 'manual', 'event');

-- CreateEnum
CREATE TYPE "AgentRunStatus" AS ENUM ('queued', 'running', 'success', 'failed', 'needs_human');

-- CreateEnum
CREATE TYPE "AgentRunResolution" AS ENUM ('applied', 'closed');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "NotificationEvent" ADD VALUE 'agent_run_failed';
ALTER TYPE "NotificationEvent" ADD VALUE 'agent_needs_human';

-- CreateTable
CREATE TABLE "agents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "handlerKey" TEXT NOT NULL,
    "vertical" "Industry",
    "department" "AgentDepartment" NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "schedule" TEXT,
    "nextRunAt" TIMESTAMP(3),
    "timeoutSeconds" INTEGER NOT NULL DEFAULT 60,
    "config" JSONB NOT NULL DEFAULT '{}',
    "requiresHumanGate" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_runs" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "leadId" TEXT,
    "leadLabel" TEXT,
    "vertical" "Industry" NOT NULL,
    "trigger" "AgentRunTrigger" NOT NULL,
    "status" "AgentRunStatus" NOT NULL,
    "triggeredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "summary" TEXT NOT NULL DEFAULT '',
    "detail" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolution" "AgentRunResolution",
    "resolutionNote" TEXT,

    CONSTRAINT "agent_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agents_enabled_nextRunAt_idx" ON "agents"("enabled", "nextRunAt");

-- CreateIndex
CREATE UNIQUE INDEX "agents_companyId_name_key" ON "agents"("companyId", "name");

-- CreateIndex
CREATE INDEX "agent_runs_companyId_createdAt_idx" ON "agent_runs"("companyId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_companyId_status_createdAt_idx" ON "agent_runs"("companyId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_agentId_createdAt_idx" ON "agent_runs"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "agent_runs_agentId_vertical_status_idx" ON "agent_runs"("agentId", "vertical", "status");

-- CreateIndex
CREATE INDEX "agent_runs_status_startedAt_idx" ON "agent_runs"("status", "startedAt");

-- CreateIndex
CREATE INDEX "agent_runs_leadId_idx" ON "agent_runs"("leadId");

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agents" ADD CONSTRAINT "agents_updatedById_fkey" FOREIGN KEY ("updatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE NO ACTION ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_triggeredById_fkey" FOREIGN KEY ("triggeredById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- One queued or running run per agent per workspace. The tick and Run now both
-- check before creating a run; this index is what holds when they race. Prisma
-- cannot declare a partial index, so it lives only here (migrate diff ignores it).
CREATE UNIQUE INDEX "agent_runs_one_in_flight" ON "agent_runs"("agentId", "vertical") WHERE "status" IN ('queued', 'running');
