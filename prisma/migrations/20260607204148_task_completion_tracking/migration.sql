-- Task completion stamp for duration tracking.
ALTER TABLE "tasks" ADD COLUMN "completedAt" TIMESTAMP(3);
ALTER TABLE "tasks" ADD COLUMN "completedById" TEXT;
ALTER TABLE "tasks" ADD COLUMN "completedByName" TEXT;
CREATE INDEX "tasks_companyId_createdById_idx" ON "tasks"("companyId", "createdById");
