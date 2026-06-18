import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { geocode } from "@/server/modules/geo/geocode";

// Forward geocode an address → lat/lng via the shared OSM Nominatim helper.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing query" }, { status: 400 });

  const r = await geocode(q);
  if (!r) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json(r);
}
