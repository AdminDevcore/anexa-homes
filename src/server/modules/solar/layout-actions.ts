"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";
import { year1Production, offsetPct } from "@/lib/solar-money";

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
});

const layoutSchema = z.object({
  leadId: z.string().min(1),
  blocks: z.array(blockSchema).max(40),
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
  const { leadId, blocks } = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
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

  const systemSizeKwDc = module_?.ratingW ? (moduleQty * module_.ratingW) / 1000 : 0;
  const year1ProductionKwh = year1Production(systemSizeKwDc, assumptions);
  const computedOffset = existing?.annualUsageKwh
    ? offsetPct(year1ProductionKwh, existing.annualUsageKwh)
    : 0;

  const data = {
    layoutBlocks: blocks,
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
  return {
    ok: true as const,
    moduleQty,
    systemSizeKwDc,
    year1ProductionKwh,
    offsetPct: computedOffset,
  };
}
