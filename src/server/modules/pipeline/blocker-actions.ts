"use server";

import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { BLOCKER_LABEL } from "@/lib/solar-pipeline";

const fail = (error: string) => ({ ok: false as const, error });
const ok = () => ({ ok: true as const });

async function assertInScope(companyId: string, scope: Prisma.LeadWhereInput, leadId: string) {
  const found = await prisma.lead.findFirst({ where: { ...scope, companyId, id: leadId }, select: { id: true } });
  return Boolean(found);
}

const blockerSchema = z.object({
  leadId: z.string().min(1),
  blockedBy: z.enum(["us", "ahj", "utility", "customer", "lender"]).nullable(),
  blockerNote: z.string().max(500).optional(),
});

/**
 * Set (or correct) who a deal is waiting on.
 *
 * This is the field that makes the backlog actionable: "37 deals in permitting"
 * is a wall, "12 waiting on the AHJ, 6 waiting on us, 4 waiting on the customer"
 * is a to-do list. Only the `us` bucket is anybody's fault.
 */
export async function setDealBlockerAction(input: z.infer<typeof blockerSchema>) {
  const user = await requireUser();
  const parsed = blockerSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  if (!can(user, "update", "Lead")) return fail("Not allowed.");

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  if (!(await assertInScope(user.companyId, scope, parsed.data.leadId))) return fail("Deal not found.");

  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: {
      blockedBy: parsed.data.blockedBy,
      ...(parsed.data.blockerNote !== undefined ? { blockerNote: parsed.data.blockerNote || null } : {}),
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: parsed.data.blockedBy
        ? `${user.fullName} set the blocker to ${BLOCKER_LABEL[parsed.data.blockedBy]}`
        : `${user.fullName} cleared the blocker`,
      actorId: user.userId,
      leadId: parsed.data.leadId,
    },
  });

  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return ok();
}

const touchSchema = z.object({
  leadId: z.string().min(1),
  note: z.string().max(500).optional(),
});

/**
 * Log a follow-up ("I chased the utility today").
 *
 * Resets the chase cadence. This is the ONLY thing that should reset it — the
 * reminder firing must not, or the job would silently mark its own nag as
 * progress and the deal would go quiet again.
 */
export async function logFollowUpAction(input: z.infer<typeof touchSchema>) {
  const user = await requireUser();
  const parsed = touchSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid request.");
  if (!can(user, "update", "Lead")) return fail("Not allowed.");

  const scope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  if (!(await assertInScope(user.companyId, scope, parsed.data.leadId))) return fail("Deal not found.");

  const now = new Date();
  await prisma.lead.update({
    where: { id: parsed.data.leadId },
    data: {
      lastTouchAt: now,
      // Clear the nag stamp too, so the next reminder is a full cadence away.
      lastChaseAlertAt: null,
      ...(parsed.data.note ? { blockerNote: parsed.data.note } : {}),
    },
  });

  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: parsed.data.note
        ? `${user.fullName} logged a follow-up: ${parsed.data.note}`
        : `${user.fullName} logged a follow-up`,
      actorId: user.userId,
      leadId: parsed.data.leadId,
    },
  });

  revalidatePath(`/portal/leads/${parsed.data.leadId}`);
  return ok();
}
