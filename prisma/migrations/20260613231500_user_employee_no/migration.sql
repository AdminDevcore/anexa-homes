-- AlterTable
ALTER TABLE "users" ADD COLUMN "employeeNo" INTEGER;

-- CreateIndex
CREATE UNIQUE INDEX "users_companyId_employeeNo_key" ON "users"("companyId", "employeeNo");
