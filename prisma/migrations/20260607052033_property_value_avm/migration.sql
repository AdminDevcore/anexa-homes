-- AlterTable
ALTER TABLE "knocks" ADD COLUMN     "propertyValue" INTEGER,
ADD COLUMN     "propertyValueAt" TIMESTAMP(3),
ADD COLUMN     "propertyValueSource" TEXT;

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "propertyValue" INTEGER,
ADD COLUMN     "propertyValueSource" TEXT;

-- CreateTable
CREATE TABLE "property_values" (
    "id" TEXT NOT NULL,
    "addressKey" TEXT NOT NULL,
    "address" TEXT,
    "value" INTEGER,
    "source" TEXT NOT NULL,
    "confidence" TEXT,
    "asOfDate" TIMESTAMP(3) NOT NULL,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_values_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "property_values_addressKey_key" ON "property_values"("addressKey");
