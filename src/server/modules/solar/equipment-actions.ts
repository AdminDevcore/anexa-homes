"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { recomputeDesignFigures } from "./recompute";

/**
 * Choosing what this system is built from, on the screen where it is drawn.
 *
 * The module used to be unchooseable. It came only from the catalogue's starred
 * default, on the reasoning that a rep sells a system and the approved-vendor
 * list decides the hardware — which is true, and which quietly assumed somebody
 * had starred one. A company with fifty modules and no default had no way to
 * put a panel on a design at all, so the system size, the production and the
 * offset all sat at zero with a warning pointing at Settings.
 *
 * So the default is now the FALLBACK it was always meant to be, and the deal
 * can name its own. Which is also where the choice belongs: the panel decides
 * how many fit on the roof and what each one is worth, and both of those are
 * questions you are looking at while you draw.
 *
 * Changing the module re-derives every figure that depends on it — see
 * `recomputeDesignFigures`. Nothing a rep typed is touched.
 */

const fail = (error: string) => ({ ok: false as const, error });

const schema = z.object({
  leadId: z.string().min(1),
  /** Undefined leaves a slot alone; null clears it. */
  moduleId: z.string().min(1).nullish(),
  inverterId: z.string().min(1).nullish(),
  batteryId: z.string().min(1).nullish(),
});

export async function setSolarDesignEquipmentAction(input: z.infer<typeof schema>) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = schema.safeParse(input);
  if (!parsed.success) return fail("That equipment could not be read.");
  const { leadId, moduleId, inverterId, batteryId } = parsed.data;

  const lead = await prisma.lead.findFirst({
    where: { companyId: user.companyId, id: leadId },
    select: { id: true, vertical: true },
  });
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // Every id has to be OUR catalogue, and the right kind of thing. Passing a
  // battery id into the module slot would size the system off a kWh figure.
  const checks: [string | null | undefined, "module" | "inverter" | "battery"][] = [
    [moduleId, "module"],
    [inverterId, "inverter"],
    [batteryId, "battery"],
  ];
  for (const [id, kind] of checks) {
    if (!id) continue;
    const found = await prisma.solarEquipment.findFirst({
      where: { id, companyId: user.companyId, kind },
      select: { id: true },
    });
    if (!found) return fail(`That ${kind} is not in your catalogue.`);
  }

  // Upsert, because choosing a panel is a perfectly reasonable first thing to
  // do on a deal that has no design row yet.
  const data = {
    ...(moduleId !== undefined ? { moduleId } : {}),
    ...(inverterId !== undefined ? { inverterId } : {}),
    ...(batteryId !== undefined ? { batteryId } : {}),
  };
  await prisma.solarDesign.upsert({
    where: { leadId },
    create: { companyId: user.companyId, leadId, ...data },
    update: data,
  });

  // The panel decides what every panel on the roof is worth, so the size, the
  // production and the offset all follow from it.
  const figures = await recomputeDesignFigures(user.companyId, leadId);

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal/design`);
  return { ok: true as const, figures };
}
