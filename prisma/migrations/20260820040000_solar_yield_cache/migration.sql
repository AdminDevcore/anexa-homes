-- What one plane of panels makes at one place, per NREL PVWatts.
--
-- Not per-company, and the only table here that is not: this is the weather
-- record for a grid cell and the physics of a tilted plane. It is nobody's
-- data, it does not vary by tenant, and a second company quoting the same
-- street should not pay for the same request again.
--
-- The stored yield is for a 1 kW system, so one row serves an array of any
-- size. Shading is not in here — it varies array by array while the plane's
-- yield does not.
CREATE TABLE IF NOT EXISTS "solar_yield_cache" (
  "id"           TEXT NOT NULL,
  "key"          TEXT NOT NULL,
  "lat"          DOUBLE PRECISION NOT NULL,
  "lon"          DOUBLE PRECISION NOT NULL,
  "tiltDeg"      DOUBLE PRECISION NOT NULL,
  "azimuthDeg"   DOUBLE PRECISION NOT NULL,
  "lossesPct"    DOUBLE PRECISION NOT NULL,
  "arrayType"    TEXT NOT NULL,
  "kwhPerKwYear" DOUBLE PRECISION NOT NULL,
  "monthly"      JSONB NOT NULL DEFAULT '[]',
  "station"      TEXT,
  "fetchedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "solar_yield_cache_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "solar_yield_cache_key_key"
  ON "solar_yield_cache"("key");
