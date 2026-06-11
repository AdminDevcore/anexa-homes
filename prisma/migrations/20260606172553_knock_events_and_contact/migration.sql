-- Per-house contact capture + timeline (visit history / comment log).
CREATE TYPE "KnockEventType" AS ENUM ('created', 'status_change', 'comment', 'contact_update', 'lead_created');

ALTER TABLE "knocks"
  ADD COLUMN "contactName" TEXT,
  ADD COLUMN "contactPhone" TEXT,
  ADD COLUMN "contactEmail" TEXT,
  ADD COLUMN "bestTime" TEXT;

CREATE TABLE "knock_events" (
  "id" TEXT NOT NULL,
  "companyId" TEXT NOT NULL,
  "knockId" TEXT NOT NULL,
  "type" "KnockEventType" NOT NULL,
  "body" TEXT,
  "disposition" "KnockDisposition",
  "authorId" TEXT,
  "authorName" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "knock_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "knock_events_companyId_knockId_createdAt_idx" ON "knock_events"("companyId", "knockId", "createdAt");
ALTER TABLE "knock_events" ADD CONSTRAINT "knock_events_knockId_fkey" FOREIGN KEY ("knockId") REFERENCES "knocks"("id") ON DELETE CASCADE ON UPDATE CASCADE;
