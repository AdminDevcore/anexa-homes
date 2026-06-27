-- CreateEnum
CREATE TYPE "StormSource" AS ENUM ('noaa_storm_events', 'spc_reports');

-- CreateEnum
CREATE TYPE "StormType" AS ENUM ('hail', 'wind', 'tornado');

-- CreateTable
CREATE TABLE "storm_events" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "source" "StormSource" NOT NULL,
    "externalId" TEXT,
    "type" "StormType" NOT NULL,
    "eventAt" TIMESTAMP(3) NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "hailSizeIn" DOUBLE PRECISION,
    "windSpeedMph" INTEGER,
    "tornadoScale" TEXT,
    "magnitude" DOUBLE PRECISION,
    "city" TEXT,
    "county" TEXT,
    "state" TEXT,
    "zip" TEXT,
    "narrative" TEXT,
    "raw" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storm_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storm_canvassing_zones" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusMiles" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "filtersSnapshot" JSONB,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "totalScore" INTEGER NOT NULL DEFAULT 0,
    "assignedRepId" TEXT,
    "territoryId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "storm_canvassing_zones_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "property_storm_matches" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "leadId" TEXT,
    "knockId" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "nearestEventId" TEXT,
    "distanceMiles" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dateOfLoss" TIMESTAMP(3),
    "score" INTEGER NOT NULL DEFAULT 0,
    "eventCount" INTEGER NOT NULL DEFAULT 0,
    "maxHailIn" DOUBLE PRECISION,
    "maxWindMph" INTEGER,
    "computedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "property_storm_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "storm_events_companyId_type_idx" ON "storm_events"("companyId", "type");

-- CreateIndex
CREATE INDEX "storm_events_companyId_eventAt_idx" ON "storm_events"("companyId", "eventAt");

-- CreateIndex
CREATE INDEX "storm_events_companyId_lat_lng_idx" ON "storm_events"("companyId", "lat", "lng");

-- CreateIndex
CREATE UNIQUE INDEX "storm_events_companyId_source_externalId_key" ON "storm_events"("companyId", "source", "externalId");

-- CreateIndex
CREATE INDEX "storm_canvassing_zones_companyId_idx" ON "storm_canvassing_zones"("companyId");

-- CreateIndex
CREATE INDEX "storm_canvassing_zones_companyId_assignedRepId_idx" ON "storm_canvassing_zones"("companyId", "assignedRepId");

-- CreateIndex
CREATE INDEX "property_storm_matches_companyId_score_idx" ON "property_storm_matches"("companyId", "score");

-- CreateIndex
CREATE UNIQUE INDEX "property_storm_matches_companyId_leadId_key" ON "property_storm_matches"("companyId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "property_storm_matches_companyId_knockId_key" ON "property_storm_matches"("companyId", "knockId");
