import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth/session";
import { prisma } from "@/server/db/client";
import { resolveFootprint } from "@/server/modules/solar/footprint";

/**
 * The building's outline for a deal, in the ground metres the designer draws in.
 *
 * WHAT IT IS FOR. Max roof has to cover the roof on the press, without a rep
 * tracing anything first. Where Google has modelled the building that comes
 * from its roof planes; where it has not — which is every address until the
 * Solar API is switched on — this outline is the only thing that knows where
 * the house ends.
 *
 * IT IS AN OUTLINE, NOT A ROOF. OpenStreetMap knows the walls, so this is the
 * footprint: it says nothing about hips, dormers, or where a ridge sits, and on
 * an overhanging eave it is a little small. The designer splits it at the ridge
 * the shape implies and fills each half, and every panel it puts down can be
 * moved or deleted. It is a starting point that beats an empty roof, not a
 * survey, and the screen says which it is.
 *
 * A ROUTE rather than a prop, like the roof planes and for the same reason: the
 * answer costs a call to a free, rate-limited service and a page load is the
 * wrong place to spend it. Nothing here blocks the designer from opening.
 *
 * Access is scoped by reading the Lead through the isolation extension — `Lead`
 * is a SCOPED model, so a roofing session asking for a solar deal's building
 * gets nothing back, with no extra check to forget.
 */
export const dynamic = "force-dynamic";

/** Centimetres. Finer than OpenStreetMap is, and it halves the payload. */
const round = (v: number) => Math.round(v * 100) / 100;

export async function GET(req: Request) {
  const user = await requireUser();
  const leadId = new URL(req.url).searchParams.get("leadId");
  if (!leadId) return new NextResponse("Missing leadId", { status: 400 });

  const lead = await prisma.lead.findFirst({
    where: { id: leadId, companyId: user.companyId },
    select: { id: true, lat: true, lng: true },
  });
  // No lead, or no rooftop coordinate to measure a building from. Both are
  // ordinary states that leave the designer exactly as it was.
  if (!lead || lead.lat == null || lead.lng == null) {
    return NextResponse.json({ footprint: null });
  }

  const found = await resolveFootprint(lead.lat, lead.lng);
  if (!found) return NextResponse.json({ footprint: null });

  return NextResponse.json(
    {
      footprint: {
        points: found.footprint.points.map((p) => ({ e: round(p.e), n: round(p.n) })),
        areaM2: round(found.footprint.areaM2),
      },
      // Null on a footprint too square to say which way its ridge runs — see
      // `MIN_RECTANGULARITY`. The caller then fills it as one face.
      ridgeDeg: found.ridge?.ridgeDeg ?? null,
      facings: found.ridge?.facings ?? null,
    },
    {
      // Private: it describes a customer's house. A day, because a building
      // does not move, and the answer is cheap to ask for again.
      headers: { "Cache-Control": "private, max-age=86400" },
    }
  );
}
