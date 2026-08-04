-- Drop the aerial roof-report feature entirely. The whole surface — the
-- "Build Roof Report" button, the polygon tracer, the geodesic squares math and
-- the generated PDF — was removed from the product; a roofer measures from the
-- site-survey photo checklist instead. The table goes with the code rather than
-- being left as an orphan nothing reads.
--
-- Verified empty before writing this: production `roof_reports` was 0 rows
-- (0 with traced facets, 0 with a generated PDF), so nothing is destroyed.
-- `roof_measurements` is a DIFFERENT, older model and is deliberately untouched.
ALTER TABLE "roof_reports" DROP CONSTRAINT IF EXISTS "roof_reports_companyId_fkey";
ALTER TABLE "roof_reports" DROP CONSTRAINT IF EXISTS "roof_reports_leadId_fkey";
DROP TABLE IF EXISTS "roof_reports";
