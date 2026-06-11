import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";

type LL = [number, number];
const ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

function pointInPoly(pt: LL, poly: LL[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [yi, xi] = poly[i];
    const [yj, xj] = poly[j];
    if (yi > pt[0] !== yj > pt[0] && pt[1] < ((xj - xi) * (pt[0] - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function centroid(poly: LL[]): LL {
  const s = poly.reduce((a, p) => [a[0] + p[0], a[1] + p[1]] as LL, [0, 0] as LL);
  return [s[0] / poly.length, s[1] / poly.length];
}

// Auto-detect a building footprint at a point from OpenStreetMap (Overpass) — the
// same free OSM data behind the canvassing house dots. Returns the polygon ring.
export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user) return NextResponse.json({ points: null }, { status: 401 });
  const sp = new URL(req.url).searchParams;
  const lat = parseFloat(sp.get("lat") ?? "");
  const lng = parseFloat(sp.get("lng") ?? "");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return NextResponse.json({ points: null }, { status: 400 });

  const q = `[out:json][timeout:20];(way["building"](around:35,${lat},${lng}););out geom;`;
  let data: { elements?: { type: string; geometry?: { lat: number; lon: number }[] }[] } | null = null;
  for (const ep of ENDPOINTS) {
    try {
      const res = await fetch(ep, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded", "User-Agent": "AnexaHomesCRM/1.0 (roof-report)" },
        body: `data=${encodeURIComponent(q)}`,
      });
      if (res.ok) { data = await res.json(); break; }
    } catch {
      /* try next endpoint */
    }
  }
  if (!data?.elements?.length) return NextResponse.json({ points: null });

  const polys: LL[][] = data.elements
    .filter((e) => e.type === "way" && Array.isArray(e.geometry) && e.geometry.length >= 4)
    .map((e) => e.geometry!.map((g) => [g.lat, g.lon] as LL));
  if (!polys.length) return NextResponse.json({ points: null });

  // Prefer the building that actually contains the point; else the nearest.
  let chosen = polys.find((p) => pointInPoly([lat, lng], p));
  if (!chosen) {
    const d2 = (p: LL[]) => { const c = centroid(p); return (c[0] - lat) ** 2 + (c[1] - lng) ** 2; };
    chosen = [...polys].sort((a, b) => d2(a) - d2(b))[0];
  }
  // Drop the closing duplicate vertex (OSM rings repeat the first point).
  let pts = chosen;
  const f = pts[0], l = pts[pts.length - 1];
  if (pts.length > 3 && f[0] === l[0] && f[1] === l[1]) pts = pts.slice(0, -1);

  return NextResponse.json({ points: pts });
}
