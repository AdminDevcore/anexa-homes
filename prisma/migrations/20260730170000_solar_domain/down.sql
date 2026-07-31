-- ROLLBACK for 20260730170000_solar_domain
--
--   psql "$DATABASE_URL" -f prisma/migrations/20260730170000_solar_domain/down.sql
--   DELETE FROM "_prisma_migrations" WHERE migration_name = '20260730170000_solar_domain';
--
-- Deploy the previous build first. Everything here is additive, so the rollback
-- is safe at any time. Note: the two CommissionType values ('ppw','margin')
-- cannot be removed from a Postgres enum in place; they are left behind and are
-- harmless — no pre-change code path can select them.

DROP TABLE IF EXISTS "credit_applications";
DROP TABLE IF EXISTS "solar_finance";
DROP TABLE IF EXISTS "solar_designs";
DROP TABLE IF EXISTS "solar_equipment";
DROP TABLE IF EXISTS "solar_settings";

DROP TYPE IF EXISTS "SolarEquipmentKind";
DROP TYPE IF EXISTS "MountType";
DROP TYPE IF EXISTS "CreditStatus";
DROP TYPE IF EXISTS "FinanceProduct";
