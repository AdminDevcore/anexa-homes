import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { staticMapUrl, satelliteConfigured, STATIC_MAP_MAX_PX } from "@/server/modules/property/satellite";

/**
 * The customer's own roof, from above, so the array can be drawn on it.
 *
 * PROXIED, never linked. A Static Maps URL carries the API key as a query
 * parameter, so an `<img src>` pointed at Google would publish that key to
 * every visitor of a page whose whole audience is anonymous. Here the key never
 * leaves the server — the same design the portal's property imagery already
 * uses, with the proposal token standing in for a session.
 *
 * The token unlocks ONE picture: the coordinate frozen into that proposal's own
 * snapshot. Not a lead id, not a lat/lng from the query string — either of
 * those would turn a valid proposal link into a general-purpose satellite
 * imagery proxy billed to this company.
 *
 * SENT-ONLY, like the page and the layout image. Every failure is a 404: an
 * unset key, a deal that never geocoded and a bad token are indistinguishable
 * from outside, and inside they all mean "draw the fallback".
 */
export const dynamic = "force-dynamic";

/** The zoom range the array drawing offers. 21 is Google's deepest imagery. */
const MIN_ZOOM = 17;
const MAX_ZOOM = 21;

export async function GET(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!token) return new NextResponse("Not found", { status: 404 });

  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!satelliteConfigured(key)) return new NextResponse("Not configured", { status: 404 });

  const proposal = await runUnscoped(
    "public proposal site image: resolve the proposal by its token",
    () =>
      prisma.solarProposal.findUnique({
        where: { publicToken: token },
        select: { status: true, sentAt: true, snapshot: true },
      })
  );
  if (!proposal?.sentAt) return new NextResponse("Not found", { status: 404 });
  if (!["sent", "viewed", "signed"].includes(proposal.status)) {
    return new NextResponse("Not found", { status: 404 });
  }

  const snapshot = proposal.snapshot as unknown as {
    site?: { lat?: number; lng?: number } | null;
  };
  const lat = snapshot?.site?.lat;
  const lng = snapshot?.site?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") {
    return new NextResponse("Not found", { status: 404 });
  }

  const zoom = clampZoom(new URL(req.url).searchParams.get("z"));

  const upstream = await fetch(
    staticMapUrl(key!, {
      lat,
      lng,
      type: "satellite",
      zoom,
      // No pin. A marker sits exactly where the array does and would be baked
      // into the picture the panels are drawn on top of.
      marker: false,
      // SQUARE, deliberately. Google clamps each side of a Static Maps image to
      // 640 independently, so a 16:9 request comes back square with a 200 and
      // no warning — and an overlay that assumed 16:9 then mis-scales every
      // panel on the roof. Asking for the square outright is the only way to be
      // sure the picture has the shape the geometry expects.
      width: STATIC_MAP_MAX_PX,
      height: STATIC_MAP_MAX_PX,
    }),
    { cache: "no-store" }
  );
  if (!upstream.ok) return new NextResponse("Imagery unavailable", { status: 404 });

  const body = Buffer.from(await upstream.arrayBuffer());
  return new NextResponse(new Uint8Array(body), {
    headers: {
      "Content-Type": upstream.headers.get("content-type") ?? "image/png",
      // Private: the image is a picture of where a named customer lives. Cached
      // for a day because a roof does not move, which also keeps the bill down
      // when a household reads their proposal four times in an evening.
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

function clampZoom(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return MAX_ZOOM - 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(n)));
}
