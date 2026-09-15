-- Nova voice assistant: writes proposed and awaiting the user's confirmation.
-- Additive only: one enum and one table.
-- CreateEnum
CREATE TYPE "NovaPendingStatus" AS ENUM ('pending', 'confirmed', 'cancelled', 'expired');

-- CreateTable
CREATE TABLE "nova_pending_actions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "vertical" "Industry" NOT NULL,
    "actorId" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "args" JSONB NOT NULL DEFAULT '{}',
    "summary" TEXT NOT NULL,
    "leadId" TEXT,
    "status" "NovaPendingStatus" NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "nova_pending_actions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "nova_pending_actions_companyId_actorId_status_idx" ON "nova_pending_actions"("companyId", "actorId", "status");

