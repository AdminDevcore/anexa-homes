-- Solar calendar needs a schedulable inspection (AHJ / utility, after install).
-- Additive and nullable: existing rows are unaffected and roofing never reads it.
ALTER TABLE "projects" ADD COLUMN "inspectionAt" TIMESTAMP(3);
