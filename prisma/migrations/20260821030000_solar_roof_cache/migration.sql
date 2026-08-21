-- One building's roof as Google's Solar API models it: the planes, their pitch
-- and azimuth, and Google's own panel placements. Deliberately not per-company
-- — it is the shape of a building, not anybody's data — and keyed on the
-- coordinate to six decimals so two deals on the same house share one row.

-- CreateTable
CREATE TABLE "solar_roof_cache" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "segments" JSONB NOT NULL DEFAULT '[]',
    "panels" JSONB NOT NULL DEFAULT '[]',
    "found" BOOLEAN NOT NULL DEFAULT false,
    "imageryQuality" TEXT,
    "imageryDate" TEXT,
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "solar_roof_cache_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "solar_roof_cache_key_key" ON "solar_roof_cache"("key");
