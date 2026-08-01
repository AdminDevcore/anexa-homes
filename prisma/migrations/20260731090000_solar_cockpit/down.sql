-- ROLLBACK for 20260731090000_solar_cockpit
--   psql "$DATABASE_URL" -f prisma/migrations/20260731090000_solar_cockpit/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260731090000_solar_cockpit';
-- Additive only; safe once the previous build is deployed.
DROP TABLE IF EXISTS "deal_feed_posts";
DROP TABLE IF EXISTS "solar_milestones";
DROP TYPE IF EXISTS "FeedChannel";
DROP TYPE IF EXISTS "MilestonePayee";
