import { NextResponse } from "next/server";
import { getSessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { boundingBox } from "@/server/modules/storm/geo";
import { getStormConfig } from "@/server/modules/storm/config";

// Free NWS storm-based warning (SBW) polygons via the Iowa Environmental Mesonet
// archive — severe-thunderstorm + tornado warning footprints overlaid as
// "storm-affected areas". Read-only proxy; filtered to the search region + window.

const PHENOM: Record<string, { label: string; color: string }> = {
  SV: { label: "Severe T-storm", color: "#f97316" },
  TO: { label: "Tornado", color: "#ef4444" },
};

function num(v: string | null): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export async function GET(req: Request) {
  const user = await getSessionUser();
  if (!user || !can(user, "read", "StormIntelligence")) {
    return NextResponse.json({ warnings: [] }, { status: 401 });
  }
  const sp = new URL(req.url).searchParams;
  const cfg = await getStormConfig(user.companyId);
  const lat = num(sp.get("lat"));
  const lng = num(sp.get("lng"));
  const radius = num(sp.get("radius"));
  const center = lat != null && lng != null ? { lat, lng } : cfg.center;
  const radiusMiles = radius != null && radius > 0 ? radius : cfg.radiusMiles;
  const box = boundingBox(center, radiusMiles);

  const toStr = sp.get("to");
  const fromStr = sp.get("from");
  const to = toStr ? new Date(`${toStr}T23:59:59Z`) : new Date();
  const from = fromStr ? new Date(`${fromStr}T00:00:00Z`) : new Date(to.getTime() - 21 * 86_400_000);
  if (Number.isNaN(to.getTime()) || Number.isNaN(from.getTime())) {
    return NextResponse.json({ warnings: [] });
  }
  const fmt = (d: Date) => `${d.toISOString().slice(0, 16)}Z`;
  const url = `https://mesonet.agron.iastate.edu/geojson/sbw.geojson?sts=${fmt(from)}&ets=${fmt(to)}`;

  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "AnexaHomesCRM/1.0 (storm-intelligence)" },
      next: { revalidate: 3600 },
    });
    if (!res.ok) return NextResponse.json({ warnings: [] });
    const data = (await res.json()) as {
      features?: Array<{
        id?: string;
        properties?: { phenomena?: string; significance?: string; ps?: string; issue?: string };
        geometry?: { type?: string; coordinates?: number[][][] };
      }>;
    };
    const feats = Array.isArray(data.features) ? data.features : [];
    const out: {
      id: string;
      phenomena: string;
      color: string;
      label: string;
      ps: string;
      issue: string | null;
      rings: [number, number][][];
    }[] = [];

    for (const f of feats) {
      const ph = f.properties?.phenomena ?? "";
      if (ph !== "SV" && ph !== "TO") continue;
      if (f.properties?.significance !== "W") continue;
      const geom = f.geometry;
      if (!geom || geom.type !== "Polygon" || !Array.isArray(geom.coordinates)) continue;
      const ring0 = geom.coordinates[0];
      if (!ring0) continue;
      // Keep only warnings whose polygon touches the search region.
      const hit = ring0.some(
        ([x, y]) => y >= box.minLat && y <= box.maxLat && x >= box.minLng && x <= box.maxLng,
      );
      if (!hit) continue;
      const rings = geom.coordinates.map((r) => r.map(([x, y]) => [y, x] as [number, number]));
      out.push({
        id: f.id ?? `${ph}-${out.length}`,
        phenomena: ph,
        color: PHENOM[ph].color,
        label: PHENOM[ph].label,
        ps: f.properties?.ps ?? PHENOM[ph].label,
        issue: f.properties?.issue ?? null,
        rings,
      });
      if (out.length >= 400) break;
    }
    return NextResponse.json({ warnings: out });
  } catch {
    return NextResponse.json({ warnings: [] });
  }
}
