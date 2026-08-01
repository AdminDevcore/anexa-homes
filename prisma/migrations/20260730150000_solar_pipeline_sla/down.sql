-- ROLLBACK for 20260730150000_solar_pipeline_sla
--
--   psql "$DATABASE_URL" -f prisma/migrations/20260730150000_solar_pipeline_sla/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730150000_solar_pipeline_sla';
--
-- Deploy the previous build first. All columns below are additive, so pre-change
-- code ignores them and the rollback is safe to take at any time.

ALTER TABLE "leads" DROP CONSTRAINT IF EXISTS "leads_linkedDealId_fkey";

ALTER TABLE "leads" DROP COLUMN IF EXISTS "blockedBy";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "blockerNote";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "lastTouchAt";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "lastChaseAlertAt";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "linkedDealId";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "needsReroof";
ALTER TABLE "leads" DROP COLUMN IF EXISTS "needsMpu";

ALTER TABLE "pipeline_stages" DROP COLUMN IF EXISTS "stageType";
ALTER TABLE "pipeline_stages" DROP COLUMN IF EXISTS "ownerRole";
ALTER TABLE "pipeline_stages" DROP COLUMN IF EXISTS "followUpDays";
ALTER TABLE "pipeline_stages" DROP COLUMN IF EXISTS "isActionRequired";
ALTER TABLE "pipeline_stages" DROP COLUMN IF EXISTS "defaultBlocker";

DROP TYPE IF EXISTS "StageType";
DROP TYPE IF EXISTS "BlockerParty";
