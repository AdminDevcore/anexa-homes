import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { stormAtPoint } from "@/server/modules/storm/queries";

// Storm picture for one coordinate (a house on the canvassing map): radar hail
// size at the point, nearby reports, date of loss, score, storm zone.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const lat = Number(sp.get("lat"));
  const lng = Number(sp.get("lng"));
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ error: "bad coords" }, { status: 400 });
  }
  const result = await stormAtPoint(user.companyId, lat, lng);
  return NextResponse.json(result);
}
