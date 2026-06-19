import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getDealsInBounds, type Bounds } from "@/server/modules/canvassing/queries";

// Pipeline deals (geocoded leads) plotted on the canvassing map for the current
// viewport. Company-wide by design — the map is the shared geographic source of
// truth, so every canvasser sees which homes are already deals/appointments.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ deals: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const num = (k: string) => Number(searchParams.get(k));
  const bounds: Bounds = {
    minLat: num("minLat"),
    minLng: num("minLng"),
    maxLat: num("maxLat"),
    maxLng: num("maxLng"),
  };
  if (Object.values(bounds).some((v) => Number.isNaN(v))) {
    return NextResponse.json({ deals: [] }, { status: 400 });
  }
  const deals = await getDealsInBounds(user.companyId, bounds);
  return NextResponse.json({ deals });
}
