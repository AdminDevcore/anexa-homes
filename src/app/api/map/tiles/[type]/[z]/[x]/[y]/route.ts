import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { fetchTile, isGoogleMapType } from "@/server/modules/geo/map-tiles";

/**
 * Proxies one Google basemap tile so the API key and session token stay on the
 * server (see modules/geo/map-tiles).
 *
 * Auth is not ceremony here: without it this route is an open, unmetered Google
 * tile proxy billed to us. Leaflet loads tiles as same-origin <img> requests, so
 * the session cookie rides along and the same "can read Canvassing" rule that
 * gates the map gates its tiles.
 *
 * Nothing is cached on our side — the Map Tiles terms forbid storing tile
 * content, so Google's own Cache-Control is passed through untouched and the
 * browser does the only caching there is.
 */
export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ type: string; z: string; x: string; y: string }> }
) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return new Response("Unauthorized", { status: 401 });
  }

  const { type, z, x, y } = await params;
  if (!isGoogleMapType(type)) return new Response("Unknown map type", { status: 400 });

  const nums = [z, x, y].map(Number);
  if (nums.some((n) => !Number.isInteger(n)) || nums[0] < 0 || nums[0] > 22) {
    return new Response("Bad tile coordinate", { status: 400 });
  }

  const res = await fetchTile(type, nums[0], nums[1], nums[2]);
  // Not configured, or Google refused: 404 makes Leaflet show its blank tile
  // rather than retrying a request that will never succeed.
  if (!res) return new Response("Map tiles not configured", { status: 404 });
  if (!res.ok) return new Response("Tile unavailable", { status: res.status });

  return new Response(res.body, {
    status: 200,
    headers: {
      "Content-Type": res.headers.get("content-type") ?? "image/jpeg",
      "Cache-Control": res.headers.get("cache-control") ?? "private, max-age=3600",
    },
  });
}
