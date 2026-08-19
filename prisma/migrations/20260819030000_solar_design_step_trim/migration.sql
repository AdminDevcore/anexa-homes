ALTER TABLE "solar_settings" ADD COLUMN "netMeteringProgram" TEXT;
ALTER TABLE "solar_equipment" ADD COLUMN "widthMm" INTEGER;
ALTER TABLE "solar_equipment" ADD COLUMN "heightMm" INTEGER;
ALTER TABLE "solar_designs" ADD COLUMN "layoutBlocks" JSONB NOT NULL DEFAULT '[]';

-- The programme moves from the design to the company: it is set by the utility,
-- not by the house. Carry each company's most-used value across so nobody loses
-- what they had already typed on their deals.
UPDATE "solar_settings" s
SET "netMeteringProgram" = m.value
FROM (
  SELECT DISTINCT ON ("companyId") "companyId", "netMeteringProgram" AS value
  FROM "solar_designs"
  WHERE "netMeteringProgram" IS NOT NULL AND btrim("netMeteringProgram") <> ''
  GROUP BY "companyId", "netMeteringProgram"
  ORDER BY "companyId", count(*) DESC
) m
WHERE s."companyId" = m."companyId" AND s."netMeteringProgram" IS NULL;
