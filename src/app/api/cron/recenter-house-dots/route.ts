import { prisma } from "@/server/db/client";
import { nearestBuildingCentroid } from "@/server/modules/canvassing/addresses";

// Snaps existing house dots onto their OSM rooftop centroid so pins sit on the
// house, not the street/parcel point. Processes not-knocked dots that have an
// address and haven't been recentered yet, one throttled batch per run (Overpass
// is free but rate-limited). Stamps recenteredAt either way so unmatched dots
// aren't retried forever. Vercel Cron calls with Bearer CRON_SECRET.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH = 20;
const DELAY_MS = 1200; // be polite to the free Overpass API
const MAX_SNAP_M = 40; // only move a dot if a rooftop is within ~40m
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    // Only the not-knocked "house" dots (rep-entered/converted pins are left as-is).
    const dots = await prisma.knock.findMany({
      where: { recenteredAt: null, disposition: "not_knocked", address: { not: null } },
      select: { id: true, lat: true, lng: true },
      orderBy: { knockedAt: "asc" },
      take: BATCH,
    });

    let moved = 0;
    for (let i = 0; i < dots.length; i++) {
      if (i > 0) await sleep(DELAY_MS);
      const snap = await nearestBuildingCentroid(dots[i].lat, dots[i].lng, MAX_SNAP_M);
      await prisma.knock.update({
        where: { id: dots[i].id },
        data: snap ? { lat: snap.lat, lng: snap.lng, recenteredAt: new Date() } : { recenteredAt: new Date() },
      });
      if (snap) moved++;
    }

    return Response.json({ ok: true, processed: dots.length, moved });
  } catch (err) {
    console.error("[cron:recenter-house-dots] failed", err);
    return new Response("Error", { status: 500 });
  }
}
