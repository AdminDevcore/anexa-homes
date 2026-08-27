import { NextResponse } from "next/server";
import { prisma } from "@/server/db/client";
import { getObject } from "@/server/storage";
import { runUnscoped } from "@/server/vertical/context";
import { staticMapUrl, satelliteConfigured, STATIC_MAP_MAX_PX } from "@/server/modules/property/satellite";

/**
 * The two pictures a solar proposal renders, served to a reader who has no
 * session.
 *
 * Extracted because there are now TWO ways to be such a reader: a homeowner
 * holding a share token, and this application's own headless browser holding a
 * short-lived print signature. Both render the same document, so both need the
 * same two images, and two copies of "resolve the file, check the bytes, set
 * the headers" would drift the moment either changed — with the divergence
 * showing up as a missing roof on a PDF nobody re-checks.
 *
 * What is NOT shared is the gate. Each route family authorises its own reader
 * and then hands the resolved proposal here. That split is deliberate: the
 * token route must stay SENT-ONLY, and the print route must work on a version
 * that was never sent. Folding both into one function would mean a flag
 * deciding whether the customer-facing gate applies, which is exactly the kind
 * of switch that gets passed the wrong way once.
 */

/** The zoom range the array drawing offers. 21 is Google's deepest imagery. */
const MIN_ZOOM = 17;
const MAX_ZOOM = 21;

export type ImageProposal = {
  companyId: string;
  leadId: string;
  snapshot: unknown;
};

/**
 * The panel-layout drawing frozen into this proposal's snapshot.
 *
 * Serves the file the SNAPSHOT froze, never whatever the design points at
 * today. The document is a record of what somebody was shown; swapping the
 * drawing under it after the fact quietly rewrites that record.
 */
export async function serveLayoutImage(proposal: ImageProposal): Promise<NextResponse> {
  const snapshot = proposal.snapshot as { layout?: { fileId?: string } | null };
  const fileId = snapshot?.layout?.fileId;
  if (!fileId) return notFound();

  const file = await runUnscoped(
    "proposal layout image: read the file row",
    () =>
      prisma.fileAsset.findFirst({
        where: {
          id: fileId,
          companyId: proposal.companyId,
          leadId: proposal.leadId,
          kind: "photo",
        },
        select: { storageKey: true, mimeType: true, name: true },
      })
  );
  if (!file) return notFound();

  let data: Buffer;
  try {
    data = await getObject(file.storageKey);
  } catch {
    return new NextResponse("File unavailable", { status: 404 });
  }

  return new NextResponse(new Uint8Array(data), {
    headers: {
      "Content-Type": file.mimeType ?? "image/jpeg",
      "Content-Disposition": `inline; filename="${file.name.replace(/[^a-z0-9._-]/gi, "_")}"`,
      "Cache-Control": "public, max-age=300",
    },
  });
}

/**
 * The customer's own roof from above, PROXIED rather than linked.
 *
 * A Static Maps URL carries the API key as a query parameter, so an `<img src>`
 * pointed at Google publishes that key to every visitor. Here the key never
 * leaves the server.
 *
 * The coordinate comes from the proposal's own frozen snapshot — never from the
 * query string, which would turn any valid reader into a general-purpose
 * satellite-imagery proxy billed to this company.
 */
export async function serveSiteImage(proposal: ImageProposal, req: Request): Promise<NextResponse> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!satelliteConfigured(key)) return new NextResponse("Not configured", { status: 404 });

  const snapshot = proposal.snapshot as { site?: { lat?: number; lng?: number } | null };
  const lat = snapshot?.site?.lat;
  const lng = snapshot?.site?.lng;
  if (typeof lat !== "number" || typeof lng !== "number") return notFound();

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
      // panel on the roof.
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

function notFound() {
  return new NextResponse("Not found", { status: 404 });
}

function clampZoom(raw: string | null): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return MAX_ZOOM - 1;
  return Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, Math.round(n)));
}
