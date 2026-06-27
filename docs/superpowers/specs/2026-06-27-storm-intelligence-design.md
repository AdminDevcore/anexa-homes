# Storm Intelligence Module — Design Spec

**Date:** 2026-06-27
**Status:** Approved (build all phases; zones spawn real Territories)

## Goal
Use public NOAA + SPC storm data to identify roofing canvassing opportunities,
default within 100 miles of Dallas, TX. Match storms to existing leads/knocks,
score them, surface them on a map, and turn hot areas into canvassing zones.
**Scope: NOAA Storm Events + SPC reports only. No NEXRAD radar.**

## Decisions (confirmed)
- Ingestion: admin CSV upload **and** a daily SPC auto-fetch cron.
- Matching: existing **Leads + Knocks** (geocoded), plus an on-demand address checker.
- Access: new `StormIntelligence` RBAC resource mirroring Canvassing (manage:
  super_admin/admin/manager; read: sales_rep/canvasser).
- Search center configurable per company; **default Dallas (32.7767, -96.7970) @ 100 mi.**
- "Create Canvassing Zone" also spawns a real canvassing `Territory` (+ rep assign).
- Hail score is **tiered (max one bonus)**: 2" => +70 (not additive).

## Data model (Prisma; all companyId-scoped, uuid ids, createdAt/updatedAt)
- **StormEvent**: source(StormSource), externalId?, type(StormType), eventAt, lat,
  lng, hailSizeIn?, windSpeedMph?, tornadoScale?, city?, county?, state?, zip?,
  narrative?, raw Json?. Idx [companyId,type],[companyId,eventAt],[companyId,lat,lng];
  unique [companyId,source,externalId].
- **StormCanvassingZone**: name, centerLat, centerLng, radiusMiles, filtersSnapshot
  Json, eventCount, totalScore, assignedRepId?, territoryId?, createdById.
- **PropertyStormMatch**: leadId?|knockId?, lat, lng, nearestEventId?, distanceMiles,
  dateOfLoss?, score, eventCount, maxHailIn?, maxWindMph?, computedAt. Unique per subject.
- Enums: `StormSource { noaa_storm_events, spc_reports }`, `StormType { hail, wind, tornado }`.

## Scoring (`src/server/modules/storm/scoring.ts`, pure + unit tested)
`scoreProperty({maxHailIn, maxWindMph, mostRecentEventAt, reportsWithin5mi})`:
- hail >=1" +30, >=1.5" +50, >=2" +70 (tiered, take highest)
- wind >=60mph +40
- event within last 30 days +20
- >=2 reports within 5 mi +20

## Importers (`src/server/modules/storm/`)
- `csv.ts`: tiny dependency-free CSV parser (quotes/commas/newlines).
- `import-noaa.ts`: NOAA Storm Events details CSV -> hail/wind/tornado within
  radius+buffer of center; idempotent upsert by EVENT_ID. Hail MAGNITUDE=inches,
  wind MAGNITUDE=knots->mph.
- `import-spc.ts`: SPC daily hail/wind/torn CSVs. Hail Size = hundredths inch
  (100=1.0"), wind mph, torn F-scale. Idempotent by date+coord+type key.
- `importStormCsvAction` (upload) + `/api/cron/storm-spc` (CRON_SECRET, vercel.json).
- Each import triggers match recompute.

## Search / matching (`src/server/modules/storm/queries.ts`)
- `haversineMiles()`; bounding-box prefilter in SQL then Haversine filter in app.
- `getStormEvents(filters)`: type, date range, hail size, wind speed, county, city,
  zip, center+radius (default Dallas/100mi).
- Match recompute (`/api/cron/storm-matches` + after import): every geocoded Lead +
  Knock scored vs events within 5 mi -> PropertyStormMatch (replace per subject).

## API + actions (gated by StormIntelligence)
- GET `/api/storm/events`, `/api/storm/matches`, `/api/storm/zones`,
  `/api/storm/address-check?q=` (geocode + 1/3/5/10mi rings + nearest + date of loss + score).
- Actions (manager+): `createStormZoneAction` (optionally materializes Territory via
  existing generateTerritoryPins + assigns rep), `assignStormZoneAction`, `importStormCsvAction`.
- Exports: `/portal/storm-intelligence/export` (CSV), `/portal/storm-intelligence/pdf` (pdf-lib buildReportPdf).

## UI (`/portal/storm-intelligence`, tabbed, mobile-responsive, Anexa design)
- **Map**: Leaflet storm pins by type (hail/wind/tornado), severity-sized, filter bar,
  popups w/ score, "Create Canvassing Zone".
- **Storm Leads**: scored PropertyStormMatch table (leads+knocks), sort by score,
  Export CSV + Generate PDF.
- **Address Checker**: address -> rings (1/3/5/10mi) counts, nearest storm, possible
  date of loss, score.
- **Zones**: created zones + assigned rep + link into canvassing map.

## RBAC / nav / deploy
- Add `StormIntelligence` to matrix.ts + a portal nav item (CloudLightning).
- One Prisma migration (3 tables + 2 enums). Local: `prisma migrate dev`. **Prod
  migration applied manually before/with deploy.**

## Build order
1. Schema+migration+RBAC+nav+scoring(+tests)
2. Importers (csv util, NOAA, SPC) + upload action + SPC cron
3. Queries (radius/filters) + events API + match recompute + matches API
4. UI tabs (map, storm leads, address checker, zones)
5. Exports (CSV + PDF)
6. Verify (build/lint/smoke) + deploy
