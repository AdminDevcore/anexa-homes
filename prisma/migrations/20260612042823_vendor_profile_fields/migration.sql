-- AlterTable
ALTER TABLE "bookkeeping_vendors" ADD COLUMN     "accountNumber" TEXT,
ADD COLUMN     "address" TEXT,
ADD COLUMN     "city" TEXT,
ADD COLUMN     "companyName" TEXT,
ADD COLUMN     "contactName" TEXT,
ADD COLUMN     "einTaxId" TEXT,
ADD COLUMN     "email" TEXT,
ADD COLUMN     "is1099" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "notes" TEXT,
ADD COLUMN     "phone" TEXT,
ADD COLUMN     "state" TEXT,
ADD COLUMN     "zip" TEXT;
