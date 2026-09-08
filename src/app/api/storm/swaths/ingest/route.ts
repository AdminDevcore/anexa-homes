import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { assertCronRequest } from "@/server/auth/cron";

// Ingest endpoint for the external MRMS-MESH worker. Accepts a day's hail-swath
// polygons (GeoJSON-style, [lng,lat]) + size tier, stores them as StormSwath
// rows (replace-by-day). Machine auth via Bearer CRON_SECRET, which is required
// — the route refuses when it is unset.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

type Geom = { type?: string; coordinates?: unknown };
type Feature = { hailMinIn?: number; geometry?: Geom };

function bboxOf(rings: [number, number][][]) {
  let minLat = 90;
  let minLng = 180;
  let maxLat = -90;
  let maxLng = -180;
  for (const ring of rings) {
    for (const [lat, lng] of ring) {
      if (lat < minLat) minLat = lat;
      if (lat > maxLat) maxLat = lat;
      if (lng < minLng) minLng = lng;
      if (lng > maxLng) maxLng = lng;
    }
  }
  return { minLat, minLng, maxLat, maxLng };
}

export async function POST(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;

  let body: { date?: string; source?: string; features?: Feature[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid json" }, { status: 400 });
  }
  const dateStr = String(body?.date ?? "");
  const date = new Date(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return NextResponse.json({ error: "invalid date" }, { status: 400 });
  const source = String(body?.source ?? "mrms_mesh");
  const features = Array.isArray(body?.features) ? body.features : [];

  const rows: Prisma.StormSwathCreateManyInput[] = [];
  for (const f of features) {
    const g = f?.geometry;
    if (!g || !Array.isArray(g.coordinates)) continue;
    const hailMinIn = Number(f.hailMinIn ?? 1);
    if (!Number.isFinite(hailMinIn)) continue;
    // Normalize to a list of polygons (each = [outerRing, ...holes]).
    const polys: number[][][][] =
      g.type === "MultiPolygon"
        ? (g.coordinates as number[][][][])
        : g.type === "Polygon"
          ? [g.coordinates as number[][][]]
          : [];
    for (const poly of polys) {
      const rings = poly
        .map((ring) => ring.map(([lng, lat]) => [lat, lng] as [number, number]))
        .filter((r) => r.length >= 3);
      if (!rings.length) continue;
      const bb = bboxOf(rings);
      rows.push({
        source,
        eventDate: date,
        hailMinIn,
        rings: rings as unknown as Prisma.InputJsonValue,
        bboxMinLat: bb.minLat,
        bboxMinLng: bb.minLng,
        bboxMaxLat: bb.maxLat,
        bboxMaxLng: bb.maxLng,
      });
    }
  }

  await prisma.$transaction([
    prisma.stormSwath.deleteMany({ where: { source, eventDate: date } }),
    ...(rows.length ? [prisma.stormSwath.createMany({ data: rows })] : []),
  ]);

  return NextResponse.json({ ok: true, date: dateStr, source, polygons: rows.length });
}
