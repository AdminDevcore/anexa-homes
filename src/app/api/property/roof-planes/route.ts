import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { groundPlanesFor, resolveRoofPlanes } from "@/server/modules/solar/roof-planes";

/**
 * The roof planes for a deal, in the ground metres the designer draws in.
 *
 * A ROUTE RATHER THAN A PROP because of when it is needed. The page hands the
 * designer whatever the cache already holds, so a roof somebody has looked at
 * before is on screen at first paint; this is for the other case, where the
 * answer costs a call to Google and a page load is the wrong place to spend a
 * second. The designer asks for it after mount, fills in the blanks when it
 * arrives, and draws the whole time either way.
 *
 * Proxied like the satellite imagery and for the same reason: the request
 * carries the Maps key, so a browser making it directly is a browser holding
 * the key.
 *
 * Access is scoped by reading the Lead through the isolation extension — `Lead`
 * is a SCOPED model, so a roofing session asking for a solar deal's roof gets
 * nothing back, with no extra check to forget.
 */
export const dynamic = "force-dynamic";

/** Centimetres. Finer than the model is, and it halves the payload. */
const round = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: Request) {
  const user = await requireUser();
  const leadId = new URL(req.url).searchParams.get("leadId");
  if (!leadId) return new NextResponse("Missing leadId", { status: 400 });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, lat: true, lng: true },
  });
  // No lead, or no rooftop coordinate to measure a roof from. Both are ordinary
  // states that leave every array exactly as the rep drew it.
  if (!lead || lead.lat == null || lead.lng == null) {
    return NextResponse.json({ planes: null });
  }

  const geo = await resolveRoofPlanes(lead.lat, lead.lng);
  const planes = groundPlanesFor(geo, lead.lat, lead.lng);
  if (!planes) return NextResponse.json({ planes: null });

  return NextResponse.json(
    {
      planes: {
        ...planes,
        segments: planes.segments.map((s) => ({
          ...s,
          centerE: round(s.centerE),
          centerN: round(s.centerN),
        })),
        panels: planes.panels.map((p) => ({
          e: round(p.e),
          n: round(p.n),
          segmentIndex: p.segmentIndex,
        })),
      },
    },
    {
      // Private: it describes a customer's house. A day, because a roof does
      // not move — and the server cache behind this holds it for six months.
      headers: { "Cache-Control": "private, max-age=86400" },
    }
  );
}
