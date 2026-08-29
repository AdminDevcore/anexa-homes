-- AlterTable
ALTER TABLE "solar_designs" ADD COLUMN     "ahjContactInfo" TEXT,
ADD COLUMN     "ahjContactName" TEXT,
ADD COLUMN     "ahjName" TEXT,
ADD COLUMN     "installerContact" TEXT,
ADD COLUMN     "installerTitle" TEXT,
ADD COLUMN     "interconnectionNotRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otherUtilityStatus" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "otherUtilityStatusDetail" TEXT,
ADD COLUMN     "permitNotRequired" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "permitNumber" TEXT,
ADD COLUMN     "ptoNotRequired" BOOLEAN NOT NULL DEFAULT false;

