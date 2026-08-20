-- Which model produced the design's production figure.
--
-- The customer's proposal lists the assumptions its numbers came from, and
-- "1,450 kWh per kW per year" is a false sentence on a document whose
-- production was simulated per-plane against a real weather record instead.
-- Null is the old model, which is what every existing design carries.
ALTER TABLE "solar_designs"
  ADD COLUMN IF NOT EXISTS "yieldSource"  TEXT,
  ADD COLUMN IF NOT EXISTS "yieldStation" TEXT,
  ADD COLUMN IF NOT EXISTS "yieldArrays"  INTEGER NOT NULL DEFAULT 0;
