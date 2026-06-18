# Canvassing Map as Geographic Source of Truth — Design

**Date:** 2026-06-18

## Problem
The canvassing map only plots `Knock` rows. `Lead`/`Project` records have no
coordinates and nothing geocodes them, so deals/appointments that didn't
originate from a door-knock (e.g. "Barbara Savage", an insurance-partner lead)
never appear on the map. Canvassing and the pipeline are disconnected, so reps
re-knock houses that are already deals and can't see context on the map. Also
missing: a search bar to find a house by address, name, or phone.

## Decisions (brainstorming)
- Geocode once and **store** lat/lng on the lead (free OSM Nominatim).
- Plot **every pipeline deal + projects + knocks** (color by stage; lost/dead dimmed/filterable).
- Deal pin popup shows **status + notes + a link to the deal**.
- Search by **address, name, phone**.
- **Map shows ALL company deals to any canvasser** — a deliberate, map-scoped
  exception to per-rep isolation (so nobody re-knocks a worked house).
- Build & ship **phase by phase**.

## Feasibility (already in place)
- Map: **Leaflet + free OSM tiles** (no token).
- Geocoder: **`/api/geocode`** (OSM Nominatim, free, no key) + reverse geocode.
- Global search exists for the name/phone side.

---

## Phase 1 — Give deals a location (geocoding)
- **Schema:** add `lat Float?`, `lng Float?`, `geocodedAt DateTime?` to `Lead`
  (additive migration). Projects plot via their lead's coords.
- **Server util** `geocode(address)` (factor the Nominatim logic out of the
  `/api/geocode` route into `src/server/modules/geo/`), with a polite
  User-Agent and graceful failure.
- **On create/edit:** when a lead's address is set/changed, geocode best-effort
  and store `lat/lng/geocodedAt` (never block the save).
- **Backfill:** `/api/cron/geocode-leads` cron processing a throttled batch
  (~1 req/sec, respecting Nominatim policy) of leads where `lat IS NULL AND
  address IS NOT NULL` each run; plus a one-shot script to start it. Registered
  in `vercel.json`.

## Phase 2 — Plot deals on the map
- **Query** `getDealsInBounds(companyId, bounds, filters)` → deal pins:
  `{ leadId, lat, lng, name, stage, stageColor, status, repName, phone,
  notesSnippet, projectStatus }`. **Company-wide** (not per-rep) — the agreed
  map exception; still tenant-scoped by `companyId`.
- **Markers:** deal pins visually distinct from knock teardrops (stage-colored
  "deal" marker), lost/dead dimmed + a filter toggle.
- **Popup:** "Deal · [Stage] · Rep [name]", notes snippet, **View deal** link.
- Merge deal pins with knock pins in `canvassing-client.tsx`.

## Phase 3 — Search bar (address / name / phone)
- Search box on the map:
  - **Name/phone** → match deals (reuse global search) → select → map flies to
    the deal's pin and opens its popup.
  - **Address** → `/api/geocode` → fly there + drop a focus pin; select an
    existing deal/knock there if present, else allow dropping a knock / note.
- Notes: knock pins edit knock notes (existing); deal pins add a lead note —
  reuse existing note mechanisms; popup surfaces notes + an add-note action.

## Testing
- Unit-test the pure geocode-result parsing + the deal→pin mapping.
- Verify backfill cron is idempotent (only un-geocoded leads) and throttled.
- Each phase: typecheck + build green before deploy.

## Out of scope
Paid map/geocode providers, route planning, territory auto-assignment.

## Files (by phase)
- P1: `prisma/schema.prisma` + migration; `src/server/modules/geo/` (geocode util);
  lead create/update actions; `src/app/api/cron/geocode-leads/route.ts`; `vercel.json`.
- P2: `canvassing/queries.ts` (getDealsInBounds); `canvassing-map.tsx`,
  `canvassing-client.tsx` (deal markers + popups).
- P3: a map search component; a canvassing search endpoint (or reuse global search).
