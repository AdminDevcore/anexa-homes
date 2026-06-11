-- Multi-rep territory assignment.
CREATE TABLE "territory_reps" (
  "id" TEXT NOT NULL,
  "territoryId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "territory_reps_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "territory_reps_territoryId_userId_key" ON "territory_reps"("territoryId", "userId");
CREATE INDEX "territory_reps_userId_idx" ON "territory_reps"("userId");
ALTER TABLE "territory_reps" ADD CONSTRAINT "territory_reps_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
