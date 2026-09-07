-- The sale line, for pipelines that write the name their own way.
--
-- The first backfill matched "Contract Signed" exactly, and the live solar
-- pipeline calls it "Contract Signed / Hold" — so that pipeline carried no
-- flagged stage at all. Behaviour was already right (lib/sold-stage.ts falls
-- back to the stage NAMED for the signature, which matches on the phrase), but
-- Settings showed the toggle off, and a control the company cannot see is a
-- control it does not have.
--
-- Only fills a pipeline that has NOTHING flagged: a company that has since
-- chosen its own sale stage keeps that choice.
UPDATE "pipeline_stages" s
   SET "countsAsSold" = true
 WHERE s."name" ILIKE '%contract signed%'
   AND NOT s."isLost"
   AND NOT EXISTS (
     SELECT 1 FROM "pipeline_stages" o
      WHERE o."pipelineId" = s."pipelineId" AND o."countsAsSold"
   )
   -- The earliest such stage, when a pipeline names more than one.
   AND s."position" = (
     SELECT MIN(e."position") FROM "pipeline_stages" e
      WHERE e."pipelineId" = s."pipelineId"
        AND e."name" ILIKE '%contract signed%'
        AND NOT e."isLost"
   );
