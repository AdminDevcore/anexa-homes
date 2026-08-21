import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import {
  readBuildingInsights,
  toGroundPlanes,
  type RoofPanelGeo,
  type RoofPlanes,
  type RoofPlanesGeo,
  type RoofSegmentGeo,
} from "@/lib/solar-roof-planes";

/**
 * Asking Google what a roof looks like, once, and remembering the answer.
 *
 * Everything network-shaped lives here; the parsing, the geometry and the vote
 * are in `@/lib/solar-roof-planes` where they can be tested without pretending
 * to be Google. Same split as `pvwatts.ts`, and the same three rules:
 *
 * THE KEY NEVER LEAVES THE SERVER. `GOOGLE_MAPS_API_KEY` is the same key the
 * Static Maps proxy guards, and for the same reason — a request the browser
 * makes is a key the browser has.
 *
 * FAILURE IS NEVER FATAL. No key, no coverage, a rate limit, a shape that
 * changed: all of them return null, every array keeps a null facing, and the
 * design prices on the company's market average exactly as it did before this
 * existed.
 *
 * A "NO" IS CACHED TOO. Outside Google's coverage the API answers 404, and that
 * is not a transient failure — it is the truth about that address for months.
 * Re-asking on every page load would spend a request to be told the same thing,
 * so a miss is stored with `found: false` and simply expires sooner.
 *
 * COST: Building Insights is billed per request with 10,000 a month free, so a
 * cached roof is the difference between pennies a year and pennies a redraw.
 */

const SOLAR_URL = "https://solar.googleapis.com/v1/buildingInsights:findClosest";

/**
 * How long an answer stays good.
 *
 * A roof changes when somebody re-roofs or builds an extension, which is rare
 * and which a rep standing in front of the house will see before we do. Half a
 * year is well inside how often Google refreshes the underlying imagery.
 */
const FOUND_TTL_DAYS = 180;

/**
 * And how long a "there is no roof here" stands. Shorter, because coverage
 * genuinely does expand — Google adds regions, and an address that had nothing
 * last quarter may have a model this one.
 */
const MISSING_TTL_DAYS = 30;

/**
 * Six decimals — about 11 cm, so the key identifies a house and not a
 * neighbourhood. Rounding coarser would hand a neighbour's roof to a deal, and
 * the whole point of the lookup is that it belongs to THIS building.
 */
export function roofCacheKey(lat: number, lng: number): string {
  const round = (v: number) => (Math.round(v * 1e6) / 1e6).toFixed(6);
  return `${round(lat)}|${round(lng)}`;
}

/** True when a stored answer is still worth trusting. */
function fresh(row: { found: boolean; fetchedAt: Date }): boolean {
  const days = row.found ? FOUND_TTL_DAYS : MISSING_TTL_DAYS;
  return Date.now() - row.fetchedAt.getTime() < days * 24 * 60 * 60 * 1000;
}

const UNSCOPED = "solar roof cache: reference data, no tenant column";

type CacheRow = {
  found: boolean;
  fetchedAt: Date;
  segments: unknown;
  panels: unknown;
  imageryQuality: string | null;
  imageryDate: string | null;
};

/** A stored row → the roof, or null for a row that says there is none. */
function fromRow(row: CacheRow): RoofPlanesGeo | null {
  if (!row.found) return null;
  const segments = Array.isArray(row.segments) ? (row.segments as RoofSegmentGeo[]) : [];
  if (segments.length === 0) return null;
  return {
    segments,
    panels: Array.isArray(row.panels) ? (row.panels as RoofPanelGeo[]) : [],
    imageryQuality:
      row.imageryQuality === "HIGH" || row.imageryQuality === "MEDIUM" || row.imageryQuality === "LOW"
        ? row.imageryQuality
        : null,
    imageryDate: row.imageryDate,
  };
}

/**
 * What the cache already holds for this building, and nothing more.
 *
 * A page LOAD uses this. Opening the designer must not be slower than drawing
 * on it — the same rule `cachedPlaneYields` follows, and for the same reason.
 * On a miss the designer asks the route for it in the background, so the first
 * open of a roof nobody has looked at costs a second, not a blank page.
 */
export async function cachedRoofPlanes(
  lat: number | null,
  lng: number | null
): Promise<RoofPlanesGeo | null> {
  if (lat == null || lng == null) return null;
  const row = await runUnscoped(UNSCOPED, () =>
    prisma.solarRoofCache.findUnique({ where: { key: roofCacheKey(lat, lng) } })
  );
  if (!row || !fresh(row)) return null;
  return fromRow(row);
}

/**
 * The roof for this building — from the cache when it is there, from Google
 * when it is not.
 *
 * Saving a layout uses this, so what gets STORED against a design is settled by
 * the building's own geometry even if the rep never waited for the preview.
 */
export async function resolveRoofPlanes(
  lat: number | null,
  lng: number | null
): Promise<RoofPlanesGeo | null> {
  if (lat == null || lng == null) return null;
  const key = roofCacheKey(lat, lng);

  const row = await runUnscoped(UNSCOPED, () =>
    prisma.solarRoofCache.findUnique({ where: { key } })
  );
  if (row && fresh(row)) return fromRow(row);

  const fetched = await fetchRoofPlanes(lat, lng);
  // A network failure is NOT an answer. Writing `found: false` here would cache
  // a timeout for a month and quietly retire the feature for that address.
  if (fetched === "error") return row ? fromRow(row) : null;

  await runUnscoped(UNSCOPED, () =>
    prisma.solarRoofCache.upsert({
      where: { key },
      create: {
        key,
        lat,
        lng,
        found: fetched !== null,
        segments: fetched?.segments ?? [],
        panels: fetched?.panels ?? [],
        imageryQuality: fetched?.imageryQuality ?? null,
        imageryDate: fetched?.imageryDate ?? null,
      },
      update: {
        found: fetched !== null,
        segments: fetched?.segments ?? [],
        panels: fetched?.panels ?? [],
        imageryQuality: fetched?.imageryQuality ?? null,
        imageryDate: fetched?.imageryDate ?? null,
        fetchedAt: new Date(),
      },
    })
  );

  return fetched;
}

/**
 * One request.
 *
 * Three outcomes, and the difference between the last two matters: a roof,
 * `null` for "Google has no model here" — which is worth remembering — and
 * `"error"` for anything that went wrong on the way, which is not.
 */
async function fetchRoofPlanes(
  lat: number,
  lng: number
): Promise<RoofPlanesGeo | null | "error"> {
  const key = process.env.GOOGLE_MAPS_API_KEY?.trim();
  if (!key) {
    warnOnce("GOOGLE_MAPS_API_KEY is not set — roof planes cannot be read.");
    return "error";
  }

  const url = `${SOLAR_URL}?location.latitude=${lat}&location.longitude=${lng}&requiredQuality=LOW&key=${encodeURIComponent(key)}`;
  try {
    // A save must not hang on Google. Eight seconds is generous for a single
    // building lookup and short enough that a rep does not notice.
    const res = await fetch(url, { signal: AbortSignal.timeout(8_000), cache: "no-store" });

    // 404 is the ordinary "no building modelled here" — the answer worth
    // caching. Everything else is a problem with us or with them.
    if (res.status === 404) return null;
    if (res.status === 403) {
      warnOnce(
        "the Solar API refused the key (403). Enable 'Solar API' on the Google Cloud project that owns GOOGLE_MAPS_API_KEY."
      );
      return "error";
    }
    if (!res.ok) {
      console.warn(`[roof-planes] ${res.status} for ${lat},${lng}`);
      return "error";
    }
    return readBuildingInsights(await res.json());
  } catch (err) {
    console.warn("[roof-planes] request failed", err);
    return "error";
  }
}

/**
 * Said once per process, not once per deal.
 *
 * An unenabled API answers 403 to every request, and a log line per page load
 * buries the one thing anybody needs to read: the name of the switch to flick.
 */
const warned = new Set<string>();
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`[roof-planes] ${message}`);
}

/** The roof in the ground metres the designer draws in. Null when there is none. */
export function groundPlanesFor(
  geo: RoofPlanesGeo | null,
  lat: number | null,
  lng: number | null
): RoofPlanes | null {
  if (!geo || lat == null || lng == null) return null;
  return toGroundPlanes(geo, { lat, lng });
}
