import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { isGoogleMapType, viewportCopyright } from "@/server/modules/geo/map-tiles";

/**
 * The copyright line Google requires under its tiles. It depends on the
 * viewport — imagery in one county may come from a different provider than the
 * next — so the map asks for it as it moves rather than hardcoding a string.
 * Viewport requests don't count against the tile quota.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ copyright: null }, { status: 401 });
  }

  const sp = new URL(req.url).searchParams;
  const type = sp.get("type") ?? "";
  if (!isGoogleMapType(type)) return NextResponse.json({ copyright: null }, { status: 400 });

  const nums = ["zoom", "north", "south", "east", "west"].map((k) => Number(sp.get(k)));
  if (nums.some((n) => !Number.isFinite(n))) {
    return NextResponse.json({ copyright: null }, { status: 400 });
  }
  const [zoom, north, south, east, west] = nums;

  const copyright = await viewportCopyright(type, { zoom, north, south, east, west });
  return NextResponse.json({ copyright });
}
