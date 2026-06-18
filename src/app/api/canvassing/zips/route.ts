import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { fetchZipsInBounds } from "@/server/modules/canvassing/zips";

// ZIP (ZCTA) boundary outlines for the current viewport — drawn as an overlay so
// managers can turn a ZIP into a territory. Not persisted; fetched from Census.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ zips: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const num = (k: string) => Number(searchParams.get(k));
  const minLat = num("minLat"), minLng = num("minLng"), maxLat = num("maxLat"), maxLng = num("maxLng");
  if ([minLat, minLng, maxLat, maxLng].some((v) => Number.isNaN(v))) {
    return NextResponse.json({ zips: [] }, { status: 400 });
  }
  const result = await fetchZipsInBounds({ minLat, minLng, maxLat, maxLng });
  return NextResponse.json(result);
}
