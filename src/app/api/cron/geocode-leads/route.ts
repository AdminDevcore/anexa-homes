import { prisma } from "@/server/db/client";
import { resolveLeadLocation } from "@/server/modules/geo/resolve";
import { runUnscoped } from "@/server/vertical/context";
import { assertCronRequest } from "@/server/auth/cron";

// Backfills lead map coordinates from their address, rooftop-first (Google,
// falling back to free OSM Nominatim when no key is set). Picks leads that have
// an address but haven't been geocoded yet, one batch per run. Covers existing
// leads and any created since the last run. Vercel Cron calls with Bearer
// CRON_SECRET, which is required — the route refuses when it is unset.
export const maxDuration = 60;
export const dynamic = "force-dynamic";

const BATCH = 20;
const DELAY_MS = 1100; // Nominatim's ~1 req/sec policy; Google needs no such wait
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function handler(req: Request) {
  const denied = assertCronRequest(req);
  if (denied) return denied;
  try {
    // First pass (free, DB-only): inherit coordinates from a linked canvassing
    // knock. Covers deals converted from door-knocks with no geocodable street
    // address, so they still plot on the canvassing map.
    //
    // Deliberately skips deals that DO have an address: a knock pin is wherever
    // a rep's thumb landed on a phone map, and letting it win meant an edited
    // address could never re-geocode — clearing lat to force a fresh lookup
    // just handed the pass a chance to stamp the old pin back.
    let inherited = 0;
    const fromKnocks = await prisma.lead.findMany({
      where: { lat: null, knocks: { some: {} }, OR: [{ address: null }, { address: "" }] },
      select: { id: true, knocks: { select: { lat: true, lng: true }, take: 1 } },
      take: 200,
    });
    for (const l of fromKnocks) {
      const k = l.knocks[0];
      if (!k) continue;
      await prisma.lead.update({
        where: { id: l.id },
        data: { lat: k.lat, lng: k.lng, geocodedAt: new Date() },
      });
      inherited++;
    }

    const leads = await prisma.lead.findMany({
      where: { geocodedAt: null, address: { not: null } },
      select: { id: true, address: true, city: true, state: true, zip: true },
      orderBy: { createdAt: "asc" },
      take: BATCH,
    });

    let geocoded = 0;
    let rooftop = 0;
    let usedNominatim = false;
    for (let i = 0; i < leads.length; i++) {
      // Only the free geocoder needs throttling, and only once we've actually
      // fallen back to it — pacing Google at 1 req/sec wasted 19 of every 20
      // seconds of the function's 60s budget.
      if (i > 0 && usedNominatim) await sleep(DELAY_MS);
      const g = await resolveLeadLocation(leads[i]);
      if (g?.source === "nominatim") usedNominatim = true;
      // Stamp geocodedAt either way so a permanently-unfindable address isn't retried forever.
      await prisma.lead.update({
        where: { id: leads[i].id },
        data: g ? { lat: g.lat, lng: g.lng, geocodedAt: new Date() } : { geocodedAt: new Date() },
      });
      if (g) geocoded++;
      if (g?.precision === "ROOFTOP") rooftop++;
    }

    return Response.json({ ok: true, inherited, processed: leads.length, geocoded, rooftop });
  } catch (err) {
    console.error("[cron:geocode-leads] failed", err);
    return new Response("Error", { status: 500 });
  }
}

/**
 * Maintenance sweeps run over every vertical, so they declare themselves
 * company-wide rather than inheriting a workspace they do not have.
 */
export async function GET(req: Request) {
  return runUnscoped("cron: geocode every un-geocoded lead, all verticals", () => handler(req));
}
