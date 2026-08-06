/**
 * Google Map Tiles API — the basemap behind the Field Map's "Google" layers.
 *
 * Everything here is server-side, and the tiles are proxied through our own
 * route rather than fetched by the browser, for two reasons:
 *
 *  - The key stays private. GOOGLE_MAPS_API_KEY is IP-restricted (see
 *    .env.example) precisely because every other Google call we make is
 *    server-to-server; a browser-side key would need a different restriction
 *    posture and a second key to manage. Proxying keeps it to one key, and
 *    enabling "Map Tiles API" on it is the whole setup.
 *  - The session token never leaves the server. Google requires one for every
 *    tile request; it is created once per map type and reused for its full life,
 *    so a rep panning around does not mint a token per tab.
 *
 * We do NOT cache tile bytes: the Map Tiles API terms forbid storing tile
 * content, so the proxy passes Google's own Cache-Control straight through to
 * the browser and keeps nothing.
 */

const CREATE_SESSION = "https://tile.googleapis.com/v1/createSession";
const TILE = "https://tile.googleapis.com/v1/2dtiles";
const VIEWPORT = "https://tile.googleapis.com/tile/v1/viewport";

/**
 * The two Google basemaps we offer.
 *
 * `hybrid` is satellite imagery WITH the roadmap layer drawn over it — that is
 * what puts house numbers on the rooftops, which is the entire reason to reach
 * for Google here. Plain satellite would just be a second copy of what Esri
 * already gives us.
 */
export type GoogleMapType = "roadmap" | "hybrid";

export const GOOGLE_MAP_TYPES: GoogleMapType[] = ["roadmap", "hybrid"];

export function isGoogleMapType(v: string): v is GoogleMapType {
  return (GOOGLE_MAP_TYPES as string[]).includes(v);
}

/** Is the integration configured at all? Drives whether the UI offers it. */
export function mapTilesConfigured(
  key: string | undefined = process.env.GOOGLE_MAPS_API_KEY
): boolean {
  return !!key && key.trim().length > 0;
}

type Session = { token: string; expiresAt: number };

// One session per map type, held for the life of the server process. Google
// issues them for two weeks; we refresh a minute early so a request in flight
// when one lapses does not 403.
const sessions = new Map<GoogleMapType, Session>();
const inFlight = new Map<GoogleMapType, Promise<string | null>>();
const EARLY_REFRESH_MS = 60_000;

/**
 * Leaflet asks for ~20 tiles per screen. Without this, a key that lacks the Map
 * Tiles API would mint 20 failed createSession calls per pan — a request storm
 * against Google in exchange for nothing. One failure parks the map type for a
 * minute; the next attempt after that re-checks, so fixing the key in the
 * console takes effect without a redeploy.
 */
const failedUntil = new Map<GoogleMapType, number>();
const FAILURE_BACKOFF_MS = 60_000;

async function createSession(mapType: GoogleMapType, key: string): Promise<string | null> {
  const fail = (why: string) => {
    console.error(`[map-tiles] createSession ${mapType} failed: ${why}`);
    failedUntil.set(mapType, Date.now() + FAILURE_BACKOFF_MS);
    return null;
  };

  const body: Record<string, unknown> = {
    // "hybrid" is not a Google map type — it is satellite plus the roadmap layer.
    mapType: mapType === "hybrid" ? "satellite" : "roadmap",
    language: "en-US",
    region: "US",
    ...(mapType === "hybrid" ? { layerTypes: ["layerRoadmap"] } : {}),
  };

  let res: Response;
  try {
    res = await fetch(`${CREATE_SESSION}?key=${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
  } catch (err) {
    return fail(String(err));
  }
  if (!res.ok) return fail(`${res.status} ${await res.text()}`);

  const data = (await res.json()) as { session?: string; expiry?: string };
  if (!data.session) return fail("response carried no session token");
  failedUntil.delete(mapType);

  // `expiry` is seconds since the epoch, as a string.
  const expirySec = Number(data.expiry);
  const expiresAt = Number.isFinite(expirySec) ? expirySec * 1000 : Date.now() + 13 * 86_400_000;
  sessions.set(mapType, { token: data.session, expiresAt });
  return data.session;
}

/** A live session token for `mapType`, or null when Google or the key says no. */
export async function sessionToken(mapType: GoogleMapType): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;

  const held = sessions.get(mapType);
  if (held && held.expiresAt - EARLY_REFRESH_MS > Date.now()) return held.token;

  const parked = failedUntil.get(mapType);
  if (parked && parked > Date.now()) return null;

  // Collapse the stampede when a cold server takes its first tile requests.
  const pending = inFlight.get(mapType);
  if (pending) return pending;
  const p = createSession(mapType, key).finally(() => inFlight.delete(mapType));
  inFlight.set(mapType, p);
  return p;
}

/** Fetches one tile straight from Google. The caller streams it to the browser. */
export async function fetchTile(
  mapType: GoogleMapType,
  z: number,
  x: number,
  y: number
): Promise<Response | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const session = await sessionToken(mapType);
  if (!key || !session) return null;

  const url = `${TILE}/${z}/${x}/${y}?session=${encodeURIComponent(session)}&key=${encodeURIComponent(key)}`;
  const res = await fetch(url, { cache: "no-store" });
  // A stale session (server up longer than the token) reads as 403. Drop it so
  // the next request mints a fresh one rather than serving grey squares forever.
  if (res.status === 403) sessions.delete(mapType);
  return res;
}

export type Viewport = { zoom: number; north: number; south: number; east: number; west: number };

/**
 * The attribution string Google requires us to display for the tiles currently
 * on screen. It varies with the viewport (different imagery providers per area),
 * which is why it is fetched rather than hardcoded. Viewport requests are free.
 */
export async function viewportCopyright(
  mapType: GoogleMapType,
  vp: Viewport
): Promise<string | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  const session = await sessionToken(mapType);
  if (!key || !session) return null;

  const sp = new URLSearchParams({
    session,
    key,
    zoom: String(Math.round(vp.zoom)),
    north: String(vp.north),
    south: String(vp.south),
    east: String(vp.east),
    west: String(vp.west),
  });
  try {
    const res = await fetch(`${VIEWPORT}?${sp.toString()}`, { cache: "no-store" });
    if (!res.ok) return null;
    const data = (await res.json()) as { copyright?: string };
    return data.copyright ?? null;
  } catch {
    return null;
  }
}
