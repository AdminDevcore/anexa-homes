-- AlterTable
ALTER TABLE "scope_lines" ADD COLUMN     "supplementUnitPrice" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "scope_template_items" ADD COLUMN     "defaultSupplementUnitPrice" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "scopes_of_work" ADD COLUMN     "paFeePct" DOUBLE PRECISION NOT NULL DEFAULT 10;
