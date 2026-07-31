-- ROLLBACK for 20260730200000_drop_legacy_uniques
--
--   psql "$DATABASE_URL" -f prisma/migrations/20260730200000_drop_legacy_uniques/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730200000_drop_legacy_uniques';
--
-- WARNING: these narrow constraints cannot be recreated once a second vertical
-- holds a row with a duplicate name (e.g. a "Door Knock" source in both Roofing
-- and Solar). If this fails with a uniqueness error, the data has already
-- diverged and you must roll forward, not back.

CREATE UNIQUE INDEX "custom_field_defs_companyId_entity_key_key"
    ON "custom_field_defs" ("companyId", "entity", "key");
CREATE UNIQUE INDEX "lead_sources_companyId_name_key"
    ON "lead_sources" ("companyId", "name");
CREATE UNIQUE INDEX "pipelines_companyId_name_key"
    ON "pipelines" ("companyId", "name");
