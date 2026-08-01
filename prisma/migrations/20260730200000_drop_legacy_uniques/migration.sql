-- ===========================================================================
-- Drop the pre-vertical narrow unique indexes.
--
-- SEPARATE from the foundation migration on purpose. The old code upserts lead
-- sources by (companyId, name), so these indexes must survive until the new
-- code is deployed. Running this earlier would break website lead intake and
-- knock->lead conversion.
--
-- ORDER: run this AFTER the new code is live. It is safe to run at any point
-- after that, and it is required before a second vertical can have a lead
-- source, custom field or pipeline with the same name as a roofing one.
--
-- Rollback: see down.sql in this directory.
-- ===========================================================================

DROP INDEX IF EXISTS "custom_field_defs_companyId_entity_key_key";
DROP INDEX IF EXISTS "lead_sources_companyId_name_key";
DROP INDEX IF EXISTS "pipelines_companyId_name_key";
