-- CreateTable
CREATE TABLE "project_assignees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "project_assignees_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_assignees_companyId_projectId_idx" ON "project_assignees"("companyId", "projectId");

-- CreateIndex
CREATE UNIQUE INDEX "project_assignees_projectId_userId_key" ON "project_assignees"("projectId", "userId");

-- AddForeignKey
ALTER TABLE "project_assignees" ADD CONSTRAINT "project_assignees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignees" ADD CONSTRAINT "project_assignees_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_assignees" ADD CONSTRAINT "project_assignees_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
