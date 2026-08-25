-- Crew assignment becomes per VISIT, not per job.
--
-- A job has two scheduled dates that send different people to the site: the
-- install, and the AHJ / utility inspection that follows it. `project_assignees`
-- recorded only THAT someone was on the job, never WHICH of the two, so the
-- install crew and the inspection crew were indistinguishable rows and neither
-- could be shown against its own date or filtered onto the right person's
-- calendar.
--
-- Every existing row is an install: the picker that wrote them sat under the
-- "Crew" heading of the Installation tab, and no inspection crew has ever been
-- expressible. DEFAULT install therefore restates what the existing rows
-- already mean rather than guessing at them.
CREATE TYPE "AssignmentKind" AS ENUM ('install', 'inspection');

ALTER TABLE "project_assignees"
  ADD COLUMN "kind" "AssignmentKind" NOT NULL DEFAULT 'install';

-- The uniqueness rule moves with it: one row per person per VISIT. The same
-- installer being on both the install and the inspection is normal and must not
-- collide; being added to the same visit twice is still a mis-click.
DROP INDEX IF EXISTS "project_assignees_projectId_userId_key";
CREATE UNIQUE INDEX "project_assignees_projectId_userId_kind_key"
  ON "project_assignees" ("projectId", "userId", "kind");

-- Reading "what is on this person's calendar" is now a per-user, per-visit
-- lookup on every calendar render, which is what this index serves.
CREATE INDEX "project_assignees_userId_kind_idx" ON "project_assignees" ("userId", "kind");
