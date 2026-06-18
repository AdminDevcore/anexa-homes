import { prisma } from "@/server/db/client";
import { geocode, addressQuery } from "@/server/modules/geo/geocode";

// Backfills lead map coordinates from their address (free OSM Nominatim).
// Picks leads that have an address but haven't been geocoded yet, one batch per
// run, throttled to ~1 req/sec per Nominatim policy. Covers existing leads and
// any newly created since the last run. Vercel Cron calls with Bearer CRON_SECRET.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH = 20;
const DELAY_MS = 1100; // be polite to the free geocoder
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (secret && req.headers.get("authorization") !== `Bearer ${secret}`) {
    return new Response("Unauthorized", { status: 401 });
  }
  try {
    const leads = await prisma.lead.findMany({
      where: { geocodedAt: null, address: { not: null } },
      select: { id: true, address: true, city: true, state: true, zip: true },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });

    let geocoded = 0;
    for (let i = 0; i < leads.length; i++) {
      if (i > 0) await sleep(DELAY_MS);
      const g = await geocode(addressQuery(leads[i]));
      // Stamp geocodedAt either way so a permanently-unfindable address isn't retried forever.
      await prisma.lead.update({
        where: { id: leads[i].id },
        data: g ? { lat: g.lat, lng: g.lng, geocodedAt: new Date() } : { geocodedAt: new Date() },
      });
      if (g) geocoded++;
    }

    return Response.json({ ok: true, processed: leads.length, geocoded });
  } catch (err) {
    console.error("[cron:geocode-leads] failed", err);
    return new Response("Error", { status: 500 });
  }
}
