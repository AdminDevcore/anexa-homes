-- Who put a deal into each stage. Additive and nullable: a move no person made
-- names its cause in "via" instead ("automation" or "signature").
ALTER TABLE "lead_stage_events" ADD COLUMN     "movedById" TEXT,
ADD COLUMN     "via" TEXT;

-- AddForeignKey
ALTER TABLE "lead_stage_events" ADD CONSTRAINT "lead_stage_events_movedById_fkey" FOREIGN KEY ("movedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- BACKFILL. Every path that moved a deal also wrote an activity-log line in the
-- same request, so a line on the same deal within a minute of the stage row is
-- that move. Checked read-only against production before shipping: 98 rows —
-- 61 matched a person's line (none matched two people), 3 a signature, and the
-- other 34 are each deal's opening stage, which its creator put it in.

-- 1. A person dragged it, picked it, or cancelled the deal.
UPDATE "lead_stage_events" e
SET "movedById" = (
  SELECT a."actorId"
  FROM "activity_logs" a
  WHERE a."leadId" = e."leadId"
    AND a."type" = 'stage_change'
    AND a."actorId" IS NOT NULL
    AND a."createdAt" BETWEEN e."enteredAt" - INTERVAL '1 minute' AND e."enteredAt" + INTERVAL '1 minute'
    AND (
      right(a."message", length(e."stageName") + 1) = ' ' || e."stageName"
      OR a."message" LIKE '% cancelled the deal%'
    )
  ORDER BY abs(extract(epoch FROM a."createdAt" - e."enteredAt"))
  LIMIT 1
)
WHERE e."movedById" IS NULL;

-- 2. A rule moved it.
UPDATE "lead_stage_events" e
SET "via" = 'automation'
WHERE e."movedById" IS NULL
  AND e."via" IS NULL
  AND EXISTS (
    SELECT 1 FROM "activity_logs" a
    WHERE a."leadId" = e."leadId"
      AND a."type" = 'stage_change'
      AND a."actorId" IS NULL
      AND a."message" = 'Automation moved the deal to ' || e."stageName"
      AND a."createdAt" BETWEEN e."enteredAt" - INTERVAL '1 minute' AND e."enteredAt" + INTERVAL '1 minute'
  );

-- 3. The homeowner's signature advanced it. The log line is written after the
-- signed deal's pay is frozen, so it trails the stage row by a little more.
UPDATE "lead_stage_events" e
SET "via" = 'signature'
WHERE e."movedById" IS NULL
  AND e."via" IS NULL
  AND EXISTS (
    SELECT 1 FROM "activity_logs" a
    WHERE a."leadId" = e."leadId"
      AND a."type" = 'system'
      AND a."message" LIKE '% signed solar proposal v%'
      AND a."message" NOT LIKE '%not advanced%'
      AND a."createdAt" BETWEEN e."enteredAt" - INTERVAL '1 minute' AND e."enteredAt" + INTERVAL '2 minutes'
  );

-- 4. The stage a deal opened in, put there by whoever created it.
UPDATE "lead_stage_events" e
SET "movedById" = l."createdById"
FROM "leads" l
WHERE l."id" = e."leadId"
  AND e."movedById" IS NULL
  AND e."via" IS NULL
  AND l."createdById" IS NOT NULL
  AND e."enteredAt" BETWEEN l."createdAt" - INTERVAL '1 minute' AND l."createdAt" + INTERVAL '1 minute'
  AND NOT EXISTS (
    SELECT 1 FROM "lead_stage_events" p
    WHERE p."leadId" = e."leadId" AND p."enteredAt" < e."enteredAt"
  );
