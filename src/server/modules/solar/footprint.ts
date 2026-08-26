import {
  readOverpassFootprint,
  ridgeFrom,
  type Footprint,
  type RidgeReading,
} from "@/lib/solar-footprint";

/**
 * Asking OpenStreetMap what shape the building is.
 *
 * Everything network-shaped lives here; the geometry is in `@/lib/solar-footprint`
 * where it can be tested without pretending to be Overpass. Same split as
 * `pvwatts` and `roof-planes`, for the same reason.
 *
 * WHY THERE IS NO CACHE TABLE, unlike `SolarRoofCache` and `SolarYieldCache`.
 * The answer is written straight onto the design: once `applyFootprintFacing`
 * has put a facing on a block it is in `layoutBlocks`, and the recompute only
 * asks when something still has none. So a deal costs one request in its life,
 * not one per save, and a table to remember a question nobody asks twice is a
 * migration bought for nothing.
 *
 * FAILURE IS NEVER FATAL, the rule every other estimate in this module follows.
 * Overpass down, rate-limited, slow, or a building it has never heard of all
 * return null, every array keeps the facing it had, and the design prices
 * exactly as it did before this existed.
 */

/**
 * The public instance. Free, community-run and rate-limited, which is the whole
 * reason the call is made once per deal and only when an array actually lacks a
 * facing — see the header.
 */
const OVERPASS_URL = "https://overpass-api.de/api/interpreter";

/**
 * How far from the pin to look for a building, in metres.
 *
 * Generous enough to survive a geocode that landed on the kerb rather than the
 * roof, tight enough not to reach the house behind. `readOverpassFootprint`
 * narrows what comes back to the nearest one anyway; this only bounds the query.
 */
const SEARCH_RADIUS_M = 35;

/**
 * Overpass asks for a User-Agent that identifies the caller, and blocks the
 * ones that do not give it. Sending something honest is the price of a free
 * service.
 */
const USER_AGENT = "Anexa Homes solar designer (roof facing from building outline)";

/**
 * Which way this address's roof most likely falls, or null.
 *
 * Null is an ordinary answer, not an error: a building OSM has not mapped, a
 * footprint too square to have a ridge, a shed instead of a house.
 */
export async function resolveFootprintFacing(
  lat: number | null,
  lng: number | null
): Promise<RidgeReading | null> {
  if (lat == null || lng == null) return null;

  const query = `[out:json][timeout:20];way["building"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`;

  try {
    // A save must not hang on a free service being busy. Eight seconds is
    // plenty for one small query and short enough that a rep does not notice
    // it failing.
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[footprint] overpass ${res.status}`);
      return null;
    }
    const footprint = readOverpassFootprint(await res.json(), { lat, lng });
    if (!footprint) return null;
    return ridgeFrom(footprint, lat);
  } catch (err) {
    console.warn("[footprint] request failed", err);
    return null;
  }
}

/**
 * The building's outline AND its ridge, for a caller that wants to draw on it.
 *
 * `resolveFootprintFacing` throws the polygon away and keeps the angle, because
 * all it ever needed was which way an array points. The designer needs the
 * shape itself: it is the mask Max roof fills when Google has no model of the
 * house, which is every house until the Solar API is switched on.
 *
 * Both go through the same request. Keeping two functions that each ask
 * Overpass for the same building would double the load on a free, rate-limited,
 * community-run service to save passing one extra field.
 */
export async function resolveFootprint(
  lat: number | null,
  lng: number | null
): Promise<{ footprint: Footprint; ridge: RidgeReading | null } | null> {
  if (lat == null || lng == null) return null;

  const query = `[out:json][timeout:20];way["building"](around:${SEARCH_RADIUS_M},${lat},${lng});out geom;`;

  try {
    // Same eight seconds as the facing lookup, and for the same reason: a rep
    // pressing a button must not be left watching a free service being busy.
    const res = await fetch(OVERPASS_URL, {
      method: "POST",
      body: new URLSearchParams({ data: query }),
      headers: { "User-Agent": USER_AGENT },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) {
      console.warn(`[footprint] overpass ${res.status}`);
      return null;
    }
    const footprint = readOverpassFootprint(await res.json(), { lat, lng });
    if (!footprint) return null;
    return { footprint, ridge: ridgeFrom(footprint, lat) };
  } catch (err) {
    console.warn("[footprint] request failed", err);
    return null;
  }
}
