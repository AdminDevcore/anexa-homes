import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { countAddressesInPolygon } from "@/server/modules/canvassing/addresses";
import type { LatLng } from "@/lib/canvassing";

// Approximate count of homes (OSM addressed buildings) inside a ZIP/territory
// ring — shown in the "New territory" dialog. Counted on-demand via Overpass.
export const maxDuration = 30;
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ count: null }, { status: 401 });
  }
  const body = (await req.json().catch(() => null)) as { ring?: LatLng[] } | null;
  const ring = body?.ring;
  if (!Array.isArray(ring) || ring.length < 3) {
    return NextResponse.json({ count: null }, { status: 400 });
  }
  const count = await countAddressesInPolygon(ring);
  return NextResponse.json({ count });
}
