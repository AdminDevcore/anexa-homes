import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

export type GeocodeResult = { label: string; lat: number; lng: number };

// Forward-geocoding (address → coordinates) for the canvassing map search bar.
// Proxied through our server — same as /reverse — so we can set a proper
// User-Agent (OpenStreetMap Nominatim usage policy) and keep the client key-free.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ results: [] }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const q = (searchParams.get("q") ?? "").trim();
  if (q.length < 3) return NextResponse.json({ results: [] });

  try {
    const url =
      `https://nominatim.openstreetmap.org/search?format=jsonv2` +
      `&addressdetails=1&countrycodes=us&limit=6&q=${encodeURIComponent(q)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AnexaHomesCRM/1.0 (canvassing)",
        "Accept-Language": "en-US",
      },
      // Cache identical lookups for an hour.
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ results: [] });
    const data = (await res.json()) as Array<{ lat: string; lon: string; display_name?: string }>;
    const results: GeocodeResult[] = data
      .map((d) => ({
        label: d.display_name ?? "",
        lat: Number(d.lat),
        lng: Number(d.lon),
      }))
      .filter((r) => r.label && Number.isFinite(r.lat) && Number.isFinite(r.lng));
    return NextResponse.json({ results });
  } catch {
    return NextResponse.json({ results: [] });
  }
}
