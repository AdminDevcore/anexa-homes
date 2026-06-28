# Field Map — Canvassing × Storm Intelligence fusion

**Date:** 2026-06-28
**Status:** Approved (phased; deploy + check in after each phase)

## Goal
Fuse canvassing and storm intelligence into one "field battle map": storm data
renders under the houses, every house is storm-aware, and clicking a house shows
a single Property Intel card (canvassing + storm + zone + actions). Unique vs.
HailTrace (data only) or SalesRabbit (canvassing only).

## Decisions (confirmed)
- The existing **Canvassing map** becomes the unified field map. **Storm Intel**
  stays the analytics/admin hub (leads table, address checker, zones, import).
- House/knock/deal pins are **storm-score color-coded** (+ legend + score filter).
- Phased build, deploy + check in after each phase.

## Core new primitive: point storm-lookup
`stormAtPoint(lat,lng)` (src/server/modules/storm/queries.ts):
- Radar swath: point-in-polygon against StormSwath → highest `hailMinIn` tier
  containing the point = precise hail size + that swath's date.
- Nearby StormEvents within 10mi → maxHailIn, maxWindMph, mostRecent (date of
  loss), eventCount, reportsWithin5mi, nearest event.
- Score via existing `scoreProperty`.
- Returns { score, swathHailIn, hailSizeIn, dateOfLoss, maxHailIn, maxWindMph,
  eventCount, reportsWithin5mi, nearest }.
- API: `GET /api/storm/at?lat&lng` (gated read StormIntelligence; reps have it).

## Phases
1. **Point-lookup + steroid popup.** stormAtPoint + /api/storm/at + a
   `<HouseStormInfo lat lng>` storm section injected into the canvassing house/
   knock popup: hail size (radar-precise), date(s) of loss, wind, score,
   territory + storm zone membership, "use date of loss for claim" action.
2. **Storm layers on canvassing map.** Reuse swath/event/warning rendering as
   toggle overlays beneath canvassing pins (viewport/date fetched).
3. **Storm-scored pins + filter.** Color knock/deal pins by PropertyStormMatch
   score; auto-houses colored by swath tier (client point-in-polygon); legend +
   "score >= N" filter slider.
4. **Nav/labeling cleanup.** Make the fused experience read as one (Canvassing =
   field map; Storm Intel = analytics).

## Reuse / constraints
- Everything already exists: StormEvent, StormSwath, StormCanvassingZone,
  PropertyStormMatch, scoring, Haversine/bbox, the canvassing map + popups.
- No PostGIS — point-in-polygon in app (ray cast); bbox prefilter for swaths.
- Don't regress existing canvassing workflows; add, don't rip out.
