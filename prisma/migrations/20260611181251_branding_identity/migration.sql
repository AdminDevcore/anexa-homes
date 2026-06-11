-- AlterTable
ALTER TABLE "company_settings" ADD COLUMN "faviconUrl" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "fontFamily" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "recordPrefix" TEXT NOT NULL DEFAULT '';
ALTER TABLE "company_settings" ADD COLUMN "supportPhone" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "supportEmail" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "currencyCode" TEXT NOT NULL DEFAULT 'USD';
ALTER TABLE "company_settings" ADD COLUMN "locale" TEXT NOT NULL DEFAULT 'en-US';
ALTER TABLE "company_settings" ADD COLUMN "businessHours" JSONB NOT NULL DEFAULT '{}';
ALTER TABLE "company_settings" ADD COLUMN "emailFromName" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "customDomain" TEXT;
ALTER TABLE "company_settings" ADD COLUMN "removePoweredBy" BOOLEAN NOT NULL DEFAULT false;
CREATE UNIQUE INDEX "company_settings_customDomain_key" ON "company_settings"("customDomain");
