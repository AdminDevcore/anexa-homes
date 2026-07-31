-- ROLLBACK for 20260730190000_solar_proposal
--   psql "$DATABASE_URL" -f prisma/migrations/20260730190000_solar_proposal/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730190000_solar_proposal';
-- Additive only; safe to take at any time once the previous build is deployed.
DROP TABLE IF EXISTS "solar_proposal_events";
DROP TABLE IF EXISTS "solar_proposals";
