# MRMS hail-swath worker (free radar swaths)

Pulls NOAA **MRMS MESH** (Maximum Estimated Size of Hail, daily-max) for the
Dallas region, turns it into size-tiered GeoJSON polygons, and POSTs them to the
Anexa app's ingest endpoint. Runs daily on **GitHub Actions** — $0.

- **Data:** NOAA Open Data S3 `noaa-mrms-pds` → `CONUS/MESH_Max_1440min_00.50/`
  (anonymous, no key; public domain; experimental data).
- **Output:** `StormSwath` rows rendered as the **Radar** layer on the Storm
  Intelligence map.

## One-time setup
1. In the GitHub repo: **Settings → Secrets and variables → Actions → New secret**:
   - `STORM_INGEST_URL` = `https://anexahomes.com/api/storm/swaths/ingest`
   - `STORM_CRON_SECRET` = the same value as the app's `CRON_SECRET` (Vercel env var)
2. **Settings → Actions → General** → allow workflows to run.
3. The workflow `.github/workflows/mrms-mesh.yml` then runs daily at 11:30 UTC.

## Manual run / backfill
- One day: **Actions → MRMS hail swaths → Run workflow**, optional `date` = `YYYYMMDD`.
- A range (locally), e.g. last 60 days:
  ```bash
  export INGEST_URL=https://anexahomes.com/api/storm/swaths/ingest
  export CRON_SECRET=<the prod CRON_SECRET>
  pip install -r worker/mrms/requirements.txt
  for i in $(seq 1 60); do
    DATE=$(date -u -d "-$i day" +%Y%m%d) python worker/mrms/fetch_mesh.py
  done
  ```

## Config (env overrides)
- `BBOX` — `minLon,minLat,maxLon,maxLat` (default Dallas `-99.2,31.0,-94.4,34.6`).
- `TIERS_IN` — hail-size tiers in inches (default `1,1.5,2,2.5,3`).

## Notes / gotchas
- MRMS longitudes are 0..360; the worker shifts them back to -180..180.
- MESH units are **mm**; tiers convert via 25.4 mm/in.
- Missing/no-coverage cells are negative flags — clamped to 0.
- First run: check the Actions log + the map's **Radar** toggle to confirm swaths render.
