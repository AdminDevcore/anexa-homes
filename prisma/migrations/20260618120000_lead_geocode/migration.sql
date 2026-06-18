-- AlterTable: geocoded coordinates for plotting leads on the canvassing map
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lat" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "lng" DOUBLE PRECISION;
ALTER TABLE "leads" ADD COLUMN IF NOT EXISTS "geocodedAt" TIMESTAMP(3);
