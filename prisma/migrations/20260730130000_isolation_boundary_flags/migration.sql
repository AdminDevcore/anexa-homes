-- Isolation boundary levers. Both default to false = books and team stay
-- shared-but-segmented, which is correct for a single legal entity.
-- See src/server/vertical/models.ts for what flipping either would mean.
ALTER TABLE "company_settings" ADD COLUMN "isolateBooks" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "company_settings" ADD COLUMN "isolateTeam"  BOOLEAN NOT NULL DEFAULT false;
