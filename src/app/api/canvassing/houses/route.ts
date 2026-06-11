import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { fetchAddressesInPolygon } from "@/server/modules/canvassing/addresses";
import type { LatLng } from "@/lib/canvassing";

// Auto-loaded house dots for the current viewport (from OSM building footprints).
// These are NOT persisted — tapping one creates the Knock on first action.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ houses: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const num = (k: string) => Number(searchParams.get(k));
  const minLat = num("minLat"), minLng = num("minLng"), maxLat = num("maxLat"), maxLng = num("maxLng");
  if ([minLat, minLng, maxLat, maxLng].some((v) => Number.isNaN(v))) {
    return NextResponse.json({ houses: [] }, { status: 400 });
  }
  // Guard against huge areas (only auto-load at house-level zoom).
  if (maxLat - minLat > 0.02 || maxLng - minLng > 0.02) {
    return NextResponse.json({ houses: [], tooBig: true });
  }
  const rect: LatLng[] = [
    [minLat, minLng],
    [minLat, maxLng],
    [maxLat, maxLng],
    [maxLat, minLng],
  ];
  const houses = await fetchAddressesInPolygon(rect, 600);
  return NextResponse.json({ houses });
}
