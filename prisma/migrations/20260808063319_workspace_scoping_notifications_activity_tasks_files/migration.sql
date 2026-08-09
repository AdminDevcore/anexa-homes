-- CreateEnum
CREATE TYPE "FileScope" AS ENUM ('company', 'workspace', 'private');

-- AlterTable
ALTER TABLE "activity_logs" ADD COLUMN     "industry" "Industry";

-- AlterTable
ALTER TABLE "files" ADD COLUMN     "industry" "Industry",
ADD COLUMN     "scope" "FileScope" NOT NULL DEFAULT 'workspace';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "industry" "Industry";

-- AlterTable
ALTER TABLE "tasks" ALTER COLUMN "industry" DROP NOT NULL,
ALTER COLUMN "industry" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "activity_logs_companyId_industry_createdAt_idx" ON "activity_logs"("companyId", "industry", "createdAt");

-- CreateIndex
CREATE INDEX "files_companyId_scope_industry_idx" ON "files"("companyId", "scope", "industry");

-- CreateIndex
CREATE INDEX "notifications_companyId_userId_industry_idx" ON "notifications"("companyId", "userId", "industry");

-- ===========================================================================
-- BACKFILL
--
-- Physical column names differ per table and that is deliberate, not a typo:
-- `leads.industry` and `tasks.industry` are the original pre-rename columns kept
-- alive by an @map so the rename cost zero DDL, while `projects.vertical` was
-- already renamed. Writing the wrong one here fails loudly at migrate time
-- rather than silently no-op'ing, which is why they are spelled out.
-- ===========================================================================

-- files.scope — the column default is 'workspace', which is right only for a
-- file hanging off a deal. Everything parentless (branding logo, GL receipt,
-- chat attachment, onboarding doc) is company-level and would otherwise become
-- invisible outside whichever workspace happened to be active. This reproduces
-- exactly the isolation the file-serve route enforces today: isolation comes
-- from the parent, and a file with no parent is not isolated at all.
UPDATE "files"
SET "scope" = 'company'
WHERE "leadId" IS NULL AND "projectId" IS NULL;

-- Deal-attached files stay 'workspace' and keep industry NULL on purpose: they
-- inherit their workspace from the parent lead/project, so duplicating it here
-- would create a second source of truth that could drift.

-- notifications.industry — recover the workspace from the deal the notification
-- points at. Anything else (payroll, commissions, a bare list link) stays NULL,
-- which reads as company-level and shows to everyone — the correct answer for
-- those events and the same thing users see today.
UPDATE "notifications" n
SET "industry" = l."industry"
FROM "leads" l
WHERE n."industry" IS NULL
  AND n."link" ~ '^/portal/leads/[0-9a-fA-F-]{36}$'
  AND l."id" = substring(n."link" from '^/portal/leads/([0-9a-fA-F-]{36})$');

UPDATE "notifications" n
SET "industry" = p."vertical"
FROM "projects" p
WHERE n."industry" IS NULL
  AND n."link" ~ '^/portal/projects/[0-9a-fA-F-]{36}$'
  AND p."id" = substring(n."link" from '^/portal/projects/([0-9a-fA-F-]{36})$');

-- activity_logs.industry — these carry real foreign keys, so no link parsing.
UPDATE "activity_logs" a
SET "industry" = l."industry"
FROM "leads" l
WHERE a."industry" IS NULL AND a."leadId" = l."id";

UPDATE "activity_logs" a
SET "industry" = p."vertical"
FROM "projects" p
WHERE a."industry" IS NULL AND a."projectId" = p."id";
