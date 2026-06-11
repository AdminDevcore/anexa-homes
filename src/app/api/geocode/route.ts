import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";

// Forward geocode an address → lat/lng via OpenStreetMap Nominatim (free, no key).
// Proxied server-side so we can set a compliant User-Agent.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const q = new URL(req.url).searchParams.get("q")?.trim();
  if (!q) return NextResponse.json({ error: "missing query" }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: { "User-Agent": "AnexaHomesCRM/1.0 (roof-report)", "Accept-Language": "en-US" },
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ error: "geocode failed" }, { status: 502 });
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
    if (!data.length) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({
      lat: Number(data[0].lat),
      lng: Number(data[0].lon),
      displayName: data[0].display_name,
    });
  } catch {
    return NextResponse.json({ error: "geocode failed" }, { status: 502 });
  }
}
