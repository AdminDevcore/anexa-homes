-- A stable, semantic identity for the Contract Signed stage. Additive.
CREATE TYPE "StageMilestone" AS ENUM ('contract_signed');

ALTER TABLE "pipeline_stages" ADD COLUMN "milestone" "StageMilestone";

CREATE UNIQUE INDEX "pipeline_stages_pipelineId_milestone_key" ON "pipeline_stages"("pipelineId", "milestone");

-- Backfill: SOLAR pipelines only, at most one stage each. The seeded key is
-- `contract_signed`; a stage made or re-made in Settings gets `<slug>_<n>` and
-- may have been renamed ("Contract Signed / Hold" in production), so the name
-- is matched too. The exact seeded key wins, then the earliest position.
-- Lost stages are never a milestone. Roofing pipelines are untouched.
UPDATE "pipeline_stages" AS s
SET "milestone" = 'contract_signed'
FROM (
  SELECT DISTINCT ON (ps."pipelineId") ps."id"
  FROM "pipeline_stages" ps
  JOIN "pipelines" p ON p."id" = ps."pipelineId"
  WHERE p."industry" = 'solar'
    AND ps."isLost" = false
    AND (ps."key" ~ '^contract_signed(_[0-9]+)?$' OR ps."name" ILIKE '%contract signed%')
  ORDER BY ps."pipelineId", (ps."key" = 'contract_signed') DESC, ps."position" ASC
) AS pick
WHERE s."id" = pick."id";
