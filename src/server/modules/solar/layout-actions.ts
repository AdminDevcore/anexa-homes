"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { systemTotals } from "@/lib/solar-arrays";
import { offsetPct } from "@/lib/solar-money";

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

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    // `lat` drives the sun's path, so the orientation penalty is this house's
    // and not a national average.
    select: { id: true, vertical: true, lat: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  const moduleQty = panelCount(blocks as LayoutBlock[]);
  if (moduleQty > 500) return fail("That is more than 500 panels — check the drawing.");

  const existing = await prisma.solarDesign.findUnique({
    where: { leadId },
    select: { moduleId: true, annualUsageKwh: true },
  });

  const assumptions = await getSolarSettings(user.companyId);
  const module_ = await resolveSizingModule(user.companyId, existing?.moduleId ?? null);

  // Production is weighted array by array now. A south plane and a north plane
  // of the same size used to contribute identical kWh, which is the difference
  // between an estimate and a guess dressed up as one.
  const totals = systemTotals(blocks as LayoutBlock[], {
    lat: lead.lat,
    moduleRatingW: module_?.ratingW ?? null,
    assumptions,
  });
  const { systemSizeKwDc, year1ProductionKwh } = totals;
  const computedOffset = existing?.annualUsageKwh
    ? offsetPct(year1ProductionKwh, existing.annualUsageKwh)
    : 0;

  const data = {
    layoutBlocks: blocks,
    // Omitted entirely when the caller did not send any, so Prisma leaves the
    // column as it is. `?? []` here would read "no setbacks in this payload"
    // as "the rep erased them all".
    ...(setbacks ? { layoutSetbacks: setbacks } : {}),
    moduleQty,
    moduleId: module_?.id ?? null,
    systemSizeKwDc,
    year1ProductionKwh,
    offsetPct: computedOffset,
  };

  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
  });

  revalidatePath(`/portal/leads/${leadId}`);
  // The builder and the full-screen designer are separate routes now, and a
  // rep goes designer -> Update proposal -> builder expecting the figures on
  // the other side to be the ones they just saved.
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal/design`);
  return {
    ok: true as const,
    moduleQty,
    systemSizeKwDc,
    year1ProductionKwh,
    offsetPct: computedOffset,
  };
}
