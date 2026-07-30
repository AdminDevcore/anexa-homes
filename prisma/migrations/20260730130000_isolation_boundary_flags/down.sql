-- ROLLBACK for 20260730130000_isolation_boundary_flags
ALTER TABLE "company_settings" DROP COLUMN IF EXISTS "isolateBooks";
ALTER TABLE "company_settings" DROP COLUMN IF EXISTS "isolateTeam";
