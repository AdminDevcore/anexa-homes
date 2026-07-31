"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { getActiveVertical } from "@/server/auth/vertical";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { runInVertical } from "@/server/vertical/context";
import { VERTICAL_LABEL } from "@/lib/vertical";

/**
 * Solar → Roofing crossover.
 *
 * When a site survey or design finds the roof needs replacing (or the main
 * panel needs upgrading), that is the highest-margin cross-sell in the
 * business: the customer is already sold, already financed, and the crew is
 * already going to be on the roof. It must be an explicit, visible branch — a
 * note in a comment field is how it gets lost.
 *
 * ISOLATION NOTE. A solar deal and its re-roof job live in DIFFERENT verticals,
 * so every operation here crosses the boundary the rest of the system exists to
 * enforce. That is deliberate and narrow:
 *
 *   • creating the roofing deal runs inside runInVertical("roofing") so the new
 *     row is correctly stamped, rather than being written from a solar context
 *   • reading the linked deal back is an explicit runUnscoped() that returns
 *     ONLY display fields (name, stage, number) — never money, never documents
 *   • both are reached exclusively through these two functions, so the
 *     crossover is one auditable seam instead of a hole in the extension
 */

const fail = (error: string) => ({ ok: false as const, error });

const flagsSchema = z.object({
  leadId: z.string().min(1),
  needsReroof: z.boolean().optional(),
  needsMpu: z.boolean().optional(),
});

/** Flag (or clear) the re-roof / MPU findings from the survey or design. */
export async function setCrossoverFlagsAction(input: z.infer<typeof flagsSchema>) {
  const user = await requireUser();
  const parsed = flagsSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  if (!can(user, "update", "Lead")) return fail("Not allowed.");

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { ...scope, companyId: user.companyId, id: parsed.data.leadId },
    select: { id: true },
  });
  if (!lead) return fail("Deal not found.");

  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: {
      ...(parsed.data.needsReroof !== undefined ? { needsReroof: parsed.data.needsReroof } : {}),
      ...(parsed.data.needsMpu !== undefined ? { needsMpu: parsed.data.needsMpu } : {}),
    },
  });

  const flags = [
    parsed.data.needsReroof !== undefined && `re-roof ${parsed.data.needsReroof ? "required" : "cleared"}`,
    parsed.data.needsMpu !== undefined && `MPU ${parsed.data.needsMpu ? "required" : "cleared"}`,
  ].filter(Boolean).join(", ");

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} updated site findings: ${flags}`,
      actorId: user.userId,
      leadId: parsed.data.leadId,
    },
  });

  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return { ok: true as const };
}

/**
 * Spawn a Roofing deal for the same property and contact, and link the two.
 *
 * One relationship, two jobs: the customer is not asked for their details
 * twice, and the roofing crew inherits the address that the solar surveyor
 * already verified.
 */
export async function createCrossoverDealAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Lead")) return fail("Not allowed.");

  const active = await getActiveVertical(user);
  const target = active === "solar" ? "roofing" : "solar";

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const source = await prisma.lead.findFirst({
    where: { ...scope, companyId: user.companyId, id: leadId },
    select: {
      id: true, firstName: true, lastName: true, coOwnerName: true, email: true, phone: true,
      address: true, city: true, state: true, zip: true, lat: true, lng: true,
      assignedRepId: true, needsReroof: true, needsMpu: true, linkedDealId: true,
    },
  });
  if (!source) return fail("Deal not found.");
  if (source.linkedDealId) return fail("This deal is already linked to one in the other workspace.");

  // Create in the TARGET vertical so the new deal is stamped correctly, rather
  // than inheriting the workspace the user happens to be looking at.
  const created = await runInVertical(target, async () => {
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId: user.companyId },
      orderBy: { isDefault: "desc" },
      include: { stages: { orderBy: { position: "asc" }, take: 1 } },
    });

    const reason = [source.needsReroof && "re-roof required", source.needsMpu && "MPU required"]
      .filter(Boolean)
      .join(" + ");

    return prisma.lead.create({
      data: {
        companyId: user.companyId,
        firstName: source.firstName,
        lastName: source.lastName,
        coOwnerName: source.coOwnerName,
        email: source.email,
        phone: source.phone,
        address: source.address,
        city: source.city,
        state: source.state,
        zip: source.zip,
        lat: source.lat,
        lng: source.lng,
        assignedRepId: source.assignedRepId,
        pipelineId: pipeline?.id ?? null,
        stageId: pipeline?.stages[0]?.id ?? null,
        stageChangedAt: new Date(),
        linkedDealId: source.id,
        notes: `Crossover from the ${VERTICAL_LABEL[active]} deal${reason ? ` — ${reason}` : ""}.`,
      },
      select: { id: true },
    });
  });

  // Close the link from the source side. Still inside the source vertical.
  await prisma.lead.update({ where: { id: source.id }, data: { linkedDealId: created.id } });

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} created a linked ${VERTICAL_LABEL[target]} deal for this property`,
      actorId: user.userId,
      leadId: source.id,
    },
  });

  revalidatePath(`/portal/leads/${source.id}`);
  return { ok: true as const, leadId: created.id, vertical: target };
}
