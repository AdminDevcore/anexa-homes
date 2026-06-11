import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

// Proxy reverse-geocoding through our server so we can set a proper User-Agent
// (OpenStreetMap Nominatim usage policy) and keep the client key-free.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "Canvassing")) {
    return NextResponse.json({ address: null }, { status: 401 });
  }
  const { searchParams } = new URL(req.url);
  const lat = searchParams.get("lat");
  const lng = searchParams.get("lng");
  if (!lat || !lng) return NextResponse.json({ address: null }, { status: 400 });

  try {
    const url = `https://nominatim.openstreetmap.org/reverse?format=jsonv2&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lng)}`;
    const res = await fetch(url, {
      headers: {
        "User-Agent": "AnexaHomesCRM/1.0 (canvassing)",
        "Accept-Language": "en-US",
      },
      // Cache identical lookups for a day.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return NextResponse.json({ address: null });
    const data = await res.json();
    const a = data.address ?? {};
    const house = [a.house_number, a.road].filter(Boolean).join(" ");
    return NextResponse.json({
      address: house || data.display_name?.split(",")[0] || null,
      city: a.city || a.town || a.village || a.hamlet || null,
      state: a.state || null,
      zip: a.postcode || null,
    });
  } catch {
    return NextResponse.json({ address: null });
  }
}
