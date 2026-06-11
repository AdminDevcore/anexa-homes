-- Remove the retired roles `project_manager` and `office_staff` from the Role enum.
-- 1) commission_rules.role is a rule CATEGORY (can be "project_manager" meaning the
--    project's assigned manager) — decouple it from the Role enum into plain text.
-- 2) Reassign any users/invitations off the retired roles.
-- 3) Recreate the Role enum without the two values.

-- 1) commission_rules.role -> text (so it can keep "project_manager" independently).
ALTER TABLE "commission_rules" ALTER COLUMN "role" TYPE TEXT USING "role"::text;

-- 2) Migrate existing user/invitation rows off the retired roles.
UPDATE "users"       SET "role" = 'manager'    WHERE "role" = 'project_manager';
UPDATE "users"       SET "role" = 'accounting' WHERE "role" = 'office_staff';
UPDATE "invitations" SET "role" = 'manager'    WHERE "role" = 'project_manager';
UPDATE "invitations" SET "role" = 'accounting' WHERE "role" = 'office_staff';

-- 3) Recreate the Role enum without project_manager / office_staff.
ALTER TYPE "Role" RENAME TO "Role_old";
CREATE TYPE "Role" AS ENUM ('super_admin', 'admin', 'manager', 'sales_rep', 'canvasser', 'marketing', 'installer', 'accounting', 'customer');

ALTER TABLE "users" ALTER COLUMN "role" DROP DEFAULT;
ALTER TABLE "users" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'sales_rep';

ALTER TABLE "invitations" ALTER COLUMN "role" TYPE "Role" USING ("role"::text::"Role");

DROP TYPE "Role_old";
