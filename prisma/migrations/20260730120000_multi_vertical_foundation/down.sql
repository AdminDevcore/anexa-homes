-- ===========================================================================
-- ROLLBACK for 20260730120000_multi_vertical_foundation
--
-- Prisma has no native down-migrations, so this is applied by hand:
--
--   psql "$DATABASE_URL" -f prisma/migrations/20260730120000_multi_vertical_foundation/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730120000_multi_vertical_foundation';
--
-- Deploy the previous application build FIRST, then run this. The @map renames
-- emitted no DDL, so pre-change code reads these tables correctly the moment it
-- is deployed — the rollback is safe to take at any time.
--
-- NOT restored (deliberately):
--   * `others` entries removed from users.industries. The value is retired; the
--     old code path filtered it out anyway, so restoring it would grant access
--     to a workspace that no longer exists. Re-grant by hand if ever needed.
-- ===========================================================================

-- ── Indexes added by the migration ─────────────────────────────────────────
DROP INDEX IF EXISTS "projects_companyId_vertical_idx";
DROP INDEX IF EXISTS "document_packages_companyId_vertical_idx";

-- ── The WIDER unique constraints added here ────────────────────────────────
-- The original narrow ones were never dropped by this migration, so they are
-- already in place and nothing needs recreating.
DROP INDEX IF EXISTS "custom_field_defs_companyId_vertical_entity_key_key";
DROP INDEX IF EXISTS "lead_sources_companyId_vertical_name_key";
DROP INDEX IF EXISTS "pipelines_companyId_industry_name_key";

-- ── The 21 added columns ───────────────────────────────────────────────────
-- Isolated (NOT NULL DEFAULT 'roofing'):
ALTER TABLE "cash_bids"                  DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "claims"                     DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "commission_rules"           DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "custom_field_defs"          DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "document_packages"          DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "knocks"                     DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "lead_sources"               DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "notification_rules"         DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "photo_templates"            DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "projects"                   DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "proposals"                  DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "roof_reports"               DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "scope_catalog_items"        DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "scope_cost_templates"       DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "scope_supplement_templates" DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "territories"                DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "welcome_call_templates"     DROP COLUMN IF EXISTS "vertical";

-- Shared-but-segmented tags (nullable):
ALTER TABLE "commissions"    DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "invoices"       DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "project_costs"  DROP COLUMN IF EXISTS "vertical";
ALTER TABLE "transactions"   DROP COLUMN IF EXISTS "vertical";

-- ── Restore the pre-migration default on the user grant list ───────────────
ALTER TABLE "users"
    ALTER COLUMN "industries" SET DEFAULT ARRAY['roofing', 'solar', 'others']::"Industry"[];
