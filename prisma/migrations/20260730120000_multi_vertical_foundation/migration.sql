-- ===========================================================================
-- Multi-vertical foundation (Phase 1)
--
-- Introduces `vertical` as a first-class, enforced dimension.
--
-- WHAT IS *NOT* HERE, ON PURPOSE:
--   No ALTER TYPE, no RENAME COLUMN. The Prisma enum `Industry` is now called
--   `Vertical` in code and every `industry` column is now called `vertical`,
--   but both are pure @map renames, so this migration emits zero rename DDL and
--   never has to be sequenced against a deploy. Old and new code both read the
--   same physical columns.
--
-- Every added column defaults to 'roofing', so existing rows are backfilled by
-- the DDL itself and the live roofing business is untouched.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

-- DropIndex
DROP INDEX "custom_field_defs_companyId_entity_key_key";

-- DropIndex
DROP INDEX "lead_sources_companyId_name_key";

-- DropIndex
DROP INDEX "pipelines_companyId_name_key";

-- AlterTable
ALTER TABLE "cash_bids" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "claims" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "commission_rules" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "commissions" ADD COLUMN     "vertical" "Industry";

-- AlterTable
ALTER TABLE "custom_field_defs" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "document_packages" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "invoices" ADD COLUMN     "vertical" "Industry";

-- AlterTable
ALTER TABLE "knocks" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "lead_sources" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "notification_rules" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "photo_templates" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "project_costs" ADD COLUMN     "vertical" "Industry";

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "proposals" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "roof_reports" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "scope_catalog_items" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "scope_cost_templates" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "scope_supplement_templates" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "territories" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- AlterTable
ALTER TABLE "transactions" ADD COLUMN     "vertical" "Industry";

-- AlterTable
ALTER TABLE "users" ALTER COLUMN "industries" SET DEFAULT ARRAY['roofing']::"Industry"[];

-- AlterTable
ALTER TABLE "welcome_call_templates" ADD COLUMN     "vertical" "Industry" NOT NULL DEFAULT 'roofing';

-- CreateIndex
CREATE UNIQUE INDEX "custom_field_defs_companyId_vertical_entity_key_key" ON "custom_field_defs"("companyId", "vertical", "entity", "key");

-- CreateIndex
CREATE INDEX "document_packages_companyId_vertical_idx" ON "document_packages"("companyId", "vertical");

-- CreateIndex
CREATE UNIQUE INDEX "lead_sources_companyId_vertical_name_key" ON "lead_sources"("companyId", "vertical", "name");

-- CreateIndex
CREATE UNIQUE INDEX "pipelines_companyId_industry_name_key" ON "pipelines"("companyId", "industry", "name");

-- CreateIndex
CREATE INDEX "projects_companyId_vertical_idx" ON "projects"("companyId", "vertical");


-- ===========================================================================
-- Backfill the shared-but-segmented (nullable) tags.
--
-- The books stay consolidated — these columns are never used to filter a read.
-- They exist so the P&L, commissions and reports break out by department and
-- still reconcile to the company total. A row that cannot be traced to a deal
-- (office rent, a general bank fee) stays NULL: genuinely company-level.
-- ===========================================================================

UPDATE "commissions" c
   SET "vertical" = l."industry"
  FROM "projects" p
  JOIN "leads" l ON l."id" = p."leadId"
 WHERE c."projectId" = p."id" AND c."vertical" IS NULL;

UPDATE "invoices" i
   SET "vertical" = l."industry"
  FROM "projects" p
  JOIN "leads" l ON l."id" = p."leadId"
 WHERE i."projectId" = p."id" AND i."vertical" IS NULL;

UPDATE "project_costs" pc
   SET "vertical" = l."industry"
  FROM "projects" p
  JOIN "leads" l ON l."id" = p."leadId"
 WHERE pc."projectId" = p."id" AND pc."vertical" IS NULL;

-- Transactions may be company-level (no project); those correctly stay NULL.
UPDATE "transactions" t
   SET "vertical" = l."industry"
  FROM "projects" p
  JOIN "leads" l ON l."id" = p."leadId"
 WHERE t."projectId" = p."id" AND t."vertical" IS NULL;

-- ===========================================================================
-- Retire `others` from live user grants.
--
-- Accounts created under the old default inherited [roofing, solar, others].
-- allowedVerticals() already filters retired values out in code; this removes
-- them at rest too, so a grant list never implies access that cannot exist.
-- Solar grants are deliberately left ALONE here — they are reviewed separately
-- before the feature flag is ever switched on.
-- ===========================================================================

UPDATE "users"
   SET "industries" = array_remove("industries", 'others'::"Industry")
 WHERE 'others' = ANY("industries");
