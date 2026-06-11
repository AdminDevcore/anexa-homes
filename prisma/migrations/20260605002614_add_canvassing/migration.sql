-- CreateEnum
CREATE TYPE "KnockDisposition" AS ENUM ('not_home', 'not_interested', 'callback', 'appointment', 'sold', 'not_qualified', 'dnk');

-- CreateTable
CREATE TABLE "territories" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT '#F4631E',
    "polygon" JSONB NOT NULL,
    "assignedRepId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "territories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knocks" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "repId" TEXT NOT NULL,
    "territoryId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "disposition" "KnockDisposition" NOT NULL DEFAULT 'not_home',
    "notes" TEXT,
    "leadId" TEXT,
    "knockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knocks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "territories_companyId_idx" ON "territories"("companyId");

-- CreateIndex
CREATE INDEX "territories_companyId_assignedRepId_idx" ON "territories"("companyId", "assignedRepId");

-- CreateIndex
CREATE INDEX "knocks_companyId_repId_idx" ON "knocks"("companyId", "repId");

-- CreateIndex
CREATE INDEX "knocks_companyId_territoryId_idx" ON "knocks"("companyId", "territoryId");

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_assignedRepId_fkey" FOREIGN KEY ("assignedRepId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "territories" ADD CONSTRAINT "territories_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_repId_fkey" FOREIGN KEY ("repId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_territoryId_fkey" FOREIGN KEY ("territoryId") REFERENCES "territories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knocks" ADD CONSTRAINT "knocks_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "leads"("id") ON DELETE SET NULL ON UPDATE CASCADE;
