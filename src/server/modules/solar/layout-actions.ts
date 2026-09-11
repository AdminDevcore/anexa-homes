"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { pinMoveAllowed } from "@/lib/map-view";
import { recomputeDesignFigures } from "./recompute";

// `actions.ts` is a "use server" module, so its helpers cannot be shared —
// every export there has to be an async server function.
const fail = (error: string) => ({ ok: false as const, error });

const blockSchema = z.object({
  id: z.string().min(1).max(40),
  // A residential array sits within a couple of hundred metres of the pin.
  // Anything beyond that is a bad drag or a bad payload, not a roof.
  originE: z.number().finite().min(-200).max(200),
  originN: z.number().finite().min(-200).max(200),
  rotationDeg: z.number().finite().min(-360).max(360),
  cols: z.number().int().min(0).max(60),
  rows: z.number().int().min(0).max(60),
  orientation: z.enum(["portrait", "landscape"]),
  omitted: z.array(z.number().int()).max(3600),
  // Which way the plane FACES and how steep it is — the only two fields here
  // that change the kWh. Nullable rather than defaulted: an array nobody has
  // described is priced on the flat company yield, exactly as before
  // orientation existed, and the designer asks for it rather than the server
  // inventing a south-facing roof.
  azimuthDeg: z.number().finite().min(-360).max(360).nullish(),
  tiltDeg: z.number().finite().min(0).max(90).nullish(),
  // What the surroundings take off this array, 0..100. Nullish for the same
  // reason as the two above: a design saved before shading existed has none,
  // and none has to keep pricing exactly as it did.
  shadePct: z.number().finite().min(0).max(100).nullish(),
  // Where the two angles above came from. Every value the server itself writes,
  // and nothing else: a browser is free to send one of these back unchanged,
  // but anything outside the list is claiming a provenance nobody earned and
  // parses to null — a person's own figure.
  facingSource: z.enum(["roof", "footprint", "traced"]).nullish(),
  /**
   * The roof plane the rep traced to produce this array.
   *
   * Bounded exactly like the setbacks and the origins are, and for the same
   * reason: a residential roof is a few tens of metres across, so a corner 200
   * m out is a bad payload rather than an eave. Nullish because every array
   * drawn by hand has none, which is most of them.
   */
  face: z
    .object({
      points: z
        .array(
          z.object({
            e: z.number().finite().min(-200).max(200),
            n: z.number().finite().min(-200).max(200),
          })
        )
        .min(3)
        .max(60),
      insetM: z.number().finite().min(0).max(10),
    })
    .nullish(),
});

/**
 * A traced fire setback. Bounded like the blocks are, and for the same reason:
 * a residential roof is a few tens of metres across, so a point 200 m out is a
 * bad payload rather than an eave.
 */
const setbackSchema = z.object({
  id: z.string().min(1).max(40),
  points: z
    .array(
      z.object({
        e: z.number().finite().min(-200).max(200),
        n: z.number().finite().min(-200).max(200),
      })
    )
    .min(2)
    .max(60),
  widthM: z.number().finite().min(0.05).max(10),
});

const layoutSchema = z.object({
  leadId: z.string().min(1),
  blocks: z.array(blockSchema).max(40),
  // Optional so an older client — or any caller that only means to change the
  // array — leaves the traced setbacks alone instead of wiping them.
  setbacks: z.array(setbackSchema).max(40).optional(),
  /**
   * Where the house actually is, when the rep has corrected it.
   *
   * IT TRAVELS WITH THE LAYOUT, and that is the point. Every block above is
   * stored in metres from this coordinate, so the two are one fact: writing a
   * new pin without the re-based geometry — or the geometry without the pin —
   * moves the array off the roof it was drawn on. One payload, one transaction,
   * no window in which the deal disagrees with itself.
   */
  origin: z
    .object({ lat: z.number().finite().min(-90).max(90), lng: z.number().finite().min(-180).max(180) })
    .optional(),
});

/**
 * Save the drawn array, and let it set the module count.
 *
 * The client never sends a panel count. It sends geometry, and the server
 * counts it — the same discipline that already governs system size and offset,
 * and for the same reason: every number a homeowner reads has to come from
 * something nobody in the browser can retype.
 */
export async function saveSolarLayoutAction(input: z.infer<typeof layoutSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = layoutSchema.safeParse(input);
  if (!parsed.success) return fail("That layout could not be read.");
  const { leadId, blocks, setbacks } = parsed.data;

  // Authorisation first, and through the viewer's own scope — a leadId from the
  // browser is a request, not a fact. The read below is then detail, not a gate.
  const allowed = await leadAccessible(user, leadId);
  if (!allowed) return fail("Deal not found.");
  if (allowed.vertical !== "solar") return fail("This is not a solar deal.");

  const lead = await prisma.lead.findFirst({
    where: { id: leadId },
    // The coordinate is the site. `lat` drives the sun's path for the fallback
    // model; both together are what PVWatts simulates the real weather for.
    select: { id: true, lat: true, lng: true },
  });
  if (!lead) return fail("Deal not found.");

  const moduleQty = panelCount(blocks as LayoutBlock[]);
  if (moduleQty > 500) return fail("That is more than 500 panels — check the drawing.");

  // The corrected pin, if there is one. Written FIRST, because the recompute
  // below simulates this design against the weather at the deal's coordinate,
  // and the whole point of moving the pin is that the old one was the wrong
  // house.
  const origin = parsed.data.origin;
  if (origin && lead.lat != null && lead.lng != null) {
    if (!pinMoveAllowed({ lat: lead.lat, lng: lead.lng }, origin)) {
      return fail("That pin is too far from the address.");
    }
    await prisma.lead.update({
      where: { id: leadId },
      data: {
        lat: origin.lat,
        lng: origin.lng,
        // Stamped so the nightly geocoder treats this as answered and never
        // overwrites a person's own correction with an interpolated guess.
        // Editing the ADDRESS still clears it, which is right: a new address
        // is a new question.
        geocodedAt: new Date(),
      },
    });
  }

  // Write the geometry, then derive everything that follows from it through
  // the one shared path — the same one that runs when the MODULE changes, so a
  // redraw and a panel swap cannot leave the design's figures computed two
  // different ways.
  await prisma.solarDesign.upsert({
    where: { leadId },
    create: {
      companyId: user.companyId,
      leadId,
      layoutBlocks: blocks,
      ...(setbacks ? { layoutSetbacks: setbacks } : {}),
    },
    update: {
      layoutBlocks: blocks,
      // Omitted entirely when the caller did not send any, so Prisma leaves the
      // column as it is. `?? []` here would read "no setbacks in this payload"
      // as "the rep erased them all".
      ...(setbacks ? { layoutSetbacks: setbacks } : {}),
    },
  });

  const figures = await recomputeDesignFigures(user.companyId, leadId);

  revalidatePath(`/portal/leads/${leadId}`);
  // The builder and the full-screen designer are separate routes now, and a
  // rep goes designer -> Update proposal -> builder expecting the figures on
  // the other side to be the ones they just saved.
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal/design`);
  return {
    ok: true as const,
    moduleQty: figures?.moduleQty ?? moduleQty,
    systemSizeKwDc: figures?.systemSizeKwDc ?? 0,
    year1ProductionKwh: figures?.year1ProductionKwh ?? 0,
    offsetPct: figures?.offsetPct ?? 0,
    /** How many arrays NREL answered for, so the designer can say. */
    measuredArrays: figures?.measuredArrays ?? 0,
    /** How many took their facing off the building on the way through. */
    filledFromRoof: figures?.filledFromRoof ?? 0,
    /** And how many only got one ESTIMATED from the building's outline. */
    filledFromOutline: figures?.filledFromOutline ?? 0,
  };
}
