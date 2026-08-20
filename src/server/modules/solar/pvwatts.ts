import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import {
  derateToLossesPct,
  plausibleYield,
  pvwattsParams,
  readPvwatts,
  yieldCacheKey,
  type ArrayType,
  type YieldRequest,
} from "@/lib/solar-pvwatts";

/**
 * Asking NREL what a roof makes, once, and remembering the answer.
 *
 * Everything network-shaped lives here; the request, the parsing and the cache
 * key are in `@/lib/solar-pvwatts` where they can be tested without pretending
 * to be NREL.
 *
 * THE CALLER NEVER WAITS ON THIS TO DRAW. The designer keeps its instant local
 * estimate while a rep drags panels around; the real figures are fetched when
 * a layout is SAVED and are what the deal, the proposal and every number a
 * homeowner reads are built from. A roof drawn on a plane nobody has priced
 * before therefore previews on the old model and settles on the real one a
 * second later — which is the honest order, because the old model was always
 * an estimate and never claimed a weather record.
 *
 * FAILURE IS NEVER FATAL. No key, a timeout, a rate limit, a shape that changed
 * — all of them return nothing, the caller falls back to the company's market
 * average, and the design records which model it used so the difference is
 * visible rather than silent.
 */

/** Where the number came from, so a proposal can say. */
export type YieldSource = "pvwatts" | "market-average";

export type PlaneYield = {
  key: string;
  kwhPerKwYear: number;
  monthly: number[];
  station: string | null;
};

/**
 * DEMO_KEY is NREL's own throttled key — about 30 requests an hour from one
 * address. Fine for a developer poking at it, useless for a company quoting
 * roofs, so production is expected to set its own free key and the log says so
 * exactly once per process rather than on every call.
 */
let warnedAboutKey = false;
function apiKey(): string {
  const key = process.env.NREL_API_KEY?.trim();
  if (key) return key;
  if (!warnedAboutKey) {
    warnedAboutKey = true;
    console.warn(
      "[pvwatts] NREL_API_KEY is not set — falling back to DEMO_KEY, which NREL rate-limits to about 30 requests an hour. Get a free key at developer.nrel.gov/signup."
    );
  }
  return "DEMO_KEY";
}

/** How long an answer stays good. Weather records move once a year at most. */
const CACHE_TTL_DAYS = 365;

/**
 * The yields for a set of planes, from the cache where possible and from NREL
 * where not.
 *
 * Deduplicated by cache key before anything is requested: a roof with four
 * arrays on the same plane is one question, and asking it four times is how a
 * throttled key runs out on a single save.
 *
 * `SolarYieldCache` carries no companyId, so it is outside the vertical-scoped
 * models and has to be read unscoped — the extension would otherwise look for a
 * workspace column that does not exist.
 */
export async function resolvePlaneYields(
  planes: YieldRequest[]
): Promise<Map<string, PlaneYield>> {
  const out = new Map<string, PlaneYield>();
  if (planes.length === 0) return out;

  const wanted = new Map<string, YieldRequest>();
  for (const p of planes) wanted.set(yieldCacheKey(p), p);

  const keys = [...wanted.keys()];
  const cached = await runUnscoped("pvwatts yield cache: reference data, no tenant column", () =>
    prisma.solarYieldCache.findMany({ where: { key: { in: keys } } })
  );

  const fresh = Date.now() - CACHE_TTL_DAYS * 24 * 60 * 60 * 1000;
  for (const row of cached) {
    if (row.fetchedAt.getTime() < fresh) continue;
    out.set(row.key, {
      key: row.key,
      kwhPerKwYear: row.kwhPerKwYear,
      monthly: Array.isArray(row.monthly) ? (row.monthly as number[]) : [],
      station: row.station,
    });
  }

  const missing = keys.filter((k) => !out.has(k));
  if (missing.length === 0) return out;

  // Sequential, not parallel. A save with six new planes on it is six requests
  // against a per-address rate limit, and firing them together is the surest
  // way to have all six refused instead of the last one.
  for (const key of missing) {
    const req = wanted.get(key)!;
    const result = await fetchPlaneYield(req);
    if (!result) continue;
    out.set(key, { key, ...result });

    await runUnscoped("pvwatts yield cache: reference data, no tenant column", () =>
      prisma.solarYieldCache.upsert({
        where: { key },
        create: {
          key,
          lat: Math.round(req.lat * 10) / 10,
          lon: Math.round(req.lon * 10) / 10,
          tiltDeg: req.tiltDeg,
          azimuthDeg: req.azimuthDeg,
          // Already a percentage — `planeFor` converted the company's derate
          // factor once. Converting again here would store a loss figure for a
          // system losing 84% of its output, under a key that says 16.
          lossesPct: Math.round(req.lossesPct),
          arrayType: req.arrayType,
          kwhPerKwYear: result.kwhPerKwYear,
          monthly: result.monthly,
          station: result.station,
        },
        update: {
          kwhPerKwYear: result.kwhPerKwYear,
          monthly: result.monthly,
          station: result.station,
          fetchedAt: new Date(),
        },
      })
    );
  }

  return out;
}

/**
 * What the cache already holds for these planes, and nothing more.
 *
 * A page LOAD uses this. Opening the designer must not be slower than drawing
 * on it, and it must not spend a rate-limited request on a plane the save is
 * about to settle anyway — so a miss here is simply a plane the preview shows
 * on the market average until it is saved.
 */
export async function cachedPlaneYields(
  planes: YieldRequest[]
): Promise<Map<string, PlaneYield>> {
  const out = new Map<string, PlaneYield>();
  if (planes.length === 0) return out;

  const keys = [...new Set(planes.map(yieldCacheKey))];
  const rows = await runUnscoped("pvwatts yield cache: reference data, no tenant column", () =>
    prisma.solarYieldCache.findMany({ where: { key: { in: keys } } })
  );
  for (const row of rows) {
    out.set(row.key, {
      key: row.key,
      kwhPerKwYear: row.kwhPerKwYear,
      monthly: Array.isArray(row.monthly) ? (row.monthly as number[]) : [],
      station: row.station,
    });
  }
  return out;
}

/** One request. Null on anything at all going wrong — see the header. */
async function fetchPlaneYield(
  req: YieldRequest
): Promise<{ kwhPerKwYear: number; monthly: number[]; station: string | null } | null> {
  const url = `https://developer.nrel.gov/api/pvwatts/v8.json?${pvwattsParams(req, apiKey())}`;
  try {
    // A save must not hang on NREL being slow. Ten seconds is generous for a
    // single simulation and short enough that a rep does not notice.
    const res = await fetch(url, { signal: AbortSignal.timeout(10_000) });
    if (!res.ok) {
      console.warn(`[pvwatts] ${res.status} for tilt ${req.tiltDeg} az ${req.azimuthDeg}`);
      return null;
    }
    const parsed = readPvwatts(await res.json());
    if (!parsed) return null;
    // The rail: a figure ten times too big would quote a homeowner a system
    // that cannot exist, and it would look merely optimistic on the page.
    if (!plausibleYield(parsed.kwhPerKwYear)) {
      console.warn(`[pvwatts] implausible yield ${parsed.kwhPerKwYear} — ignoring`);
      return null;
    }
    return parsed;
  } catch (err) {
    console.warn("[pvwatts] request failed", err);
    return null;
  }
}

/** The plane a block sits on, as PVWatts wants it. Null when undescribed. */
export function planeFor(args: {
  lat: number | null;
  lon: number | null;
  tiltDeg: number | null | undefined;
  azimuthDeg: number | null | undefined;
  derateFactor: number;
  arrayType: ArrayType;
}): YieldRequest | null {
  const { lat, lon, tiltDeg, azimuthDeg } = args;
  if (lat == null || lon == null) return null;
  // An array nobody has described has no plane to price. It keeps the market
  // average, exactly as it did before this module existed.
  if (tiltDeg == null || azimuthDeg == null) return null;
  return {
    lat,
    lon,
    tiltDeg,
    azimuthDeg,
    lossesPct: derateToLossesPct(args.derateFactor),
    arrayType: args.arrayType,
  };
}
