-- CreateEnum
DO $$ BEGIN
  CREATE TYPE "WelcomeCallStatus" AS ENUM ('sent', 'viewed', 'completed', 'voided');
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "welcome_call_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "intro" TEXT,
    "closing" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "welcome_call_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "welcome_call_sessions" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "templateId" TEXT,
    "leadId" TEXT NOT NULL,
    "projectId" TEXT,
    "customerName" TEXT NOT NULL,
    "customerEmail" TEXT,
    "status" "WelcomeCallStatus" NOT NULL DEFAULT 'sent',
    "tokenHash" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "acknowledged" JSONB NOT NULL DEFAULT '[]',
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "viewedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "confirmedIp" TEXT,
    "createdById" TEXT,

    CONSTRAINT "welcome_call_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX IF NOT EXISTS "welcome_call_templates_companyId_idx" ON "welcome_call_templates"("companyId");
CREATE UNIQUE INDEX IF NOT EXISTS "welcome_call_sessions_tokenHash_key" ON "welcome_call_sessions"("tokenHash");
CREATE INDEX IF NOT EXISTS "welcome_call_sessions_companyId_leadId_idx" ON "welcome_call_sessions"("companyId", "leadId");
CREATE INDEX IF NOT EXISTS "welcome_call_sessions_companyId_status_idx" ON "welcome_call_sessions"("companyId", "status");

-- AddForeignKey
ALTER TABLE "welcome_call_templates" ADD CONSTRAINT "welcome_call_templates_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "welcome_call_sessions" ADD CONSTRAINT "welcome_call_sessions_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "welcome_call_sessions" ADD CONSTRAINT "welcome_call_sessions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "welcome_call_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "welcome_call_sessions" ADD CONSTRAINT "welcome_call_sessions_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
