import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import {
  staticMapUrl,
  satelliteConfigured,
  parseZoomParam,
  type MapType,
} from "@/server/modules/property/satellite";
import { resolveLeadLocation } from "@/server/modules/geo/resolve";

/**
 * Serves the property image for a deal, proxying Google Static Maps.
 *
 * Proxying rather than pointing an <img> straight at Google is the whole
 * security design: the Static Maps URL carries the API key as a query
 * parameter, so a direct <img src> would publish the key to every visitor.
 * Here the key never leaves the server.
 *
 * Access is scoped by simply reading the Lead through the isolation extension —
 * `Lead` is a SCOPED model, so a roofing session asking for a solar deal's
 * imagery gets nothing back, with no extra check to forget.
 *
 * Every failure path returns 404, never 500: an unset key, an address that will
 * not geocode and a deal without an address are all ordinary states that render
 * a placeholder in the UI.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await requireUser();
  const url = new URL(req.url);
  const leadId = url.searchParams.get("leadId");
  if (!leadId) return new NextResponse("Missing leadId", { status: 400 });

  const type: MapType = url.searchParams.get("type") === "roadmap" ? "roadmap" : "satellite";
  const zoom = parseZoomParam(url.searchParams.get("zoom"));

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!satelliteConfigured(key)) return new NextResponse("Not configured", { status: 404 });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, lat: true, lng: true, address: true, city: true, state: true, zip: true },
  });
  if (!lead) return new NextResponse("Not found", { status: 404 });

  let { lat, lng } = lead;

  // Cached on the Lead, so a deal is geocoded once rather than on every load —
  // Geocoding is billed per request and the answer does not change. Editing the
  // address clears the cache (see updateLeadAction), which is what makes it safe
  // to trust: coordinates here always belong to the address shown on the card.
  if (lat == null || lng == null) {
    const point = await resolveLeadLocation(lead);
    if (!point) {
      // Stamp the attempt so a permanently unmatchable address is not retried
      // on every page view, matching the existing geocode-leads cron's contract.
      await prisma.lead.update({ where: { id: lead.id }, data: { geocodedAt: new Date() } });
      return new NextResponse("Could not locate address", { status: 404 });
    }
    lat = point.lat;
    lng = point.lng;
    await prisma.lead.update({
      where: { id: lead.id },
      data: { lat, lng, geocodedAt: new Date() },
    });
  }

  const upstream = await fetch(staticMapUrl(key!, { lat, lng, type, zoom }), { cache: "no-store" });
  if (!upstream.ok) return new NextResponse("Imagery unavailable", { status: 404 });

  const body = Buffer.from(await upstream.arrayBuffer());
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      // Private: the image reveals a customer's address. Cached for a day
      // because a roof does not move, which also keeps the Google bill down.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
