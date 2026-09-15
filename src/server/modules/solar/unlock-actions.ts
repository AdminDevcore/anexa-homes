"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { leadAccessible } from "@/server/rbac/lead-access";
import { activeUnlock, dealSignedAt, UNLOCK_WINDOW_MINUTES } from "./signed-lock";

/**
 * Reopening one signed contract, and saying why.
 *
 * A signature freezes a solar deal's economics — see `signed-lock.ts`. This is
 * the one door through, and it is deliberately a door rather than a key a super
 * admin simply carries: the reason is given BEFORE the edit, and covers the
 * whole sitting rather than being re-asked per field.
 *
 * The record it writes is the point. `SolarContractUnlock` says who reopened
 * the contract, when, why and until when; every protected write made under it
 * cites the reason on the deal's own history, alongside the old and new values.
 */

const fail = (error: string) => ({ ok: false as const, error });

const unlockSchema = z.object({
  leadId: z.string().min(1),
  /**
   * Free text, and required. A minimum length rather than a dropdown because
   * the useful reasons are specific — "lender corrected the fee to 22%" tells a
   * reader something "Pricing correction" does not. The screen offers the
   * common ones as suggestions and lets them be edited.
   */
  reason: z.string().trim().min(8, "Say why this contract is being reopened.").max(500),
});

export async function unlockSignedContractAction(input: z.infer<typeof unlockSchema>) {
  const user = await requireUser();
  /**
   * SUPER ADMIN ONLY, and checked here rather than only in the UI. An admin
   * runs the sales floor; rewriting a contract a household has signed is a
   * narrower authority than that.
   */
  if (user.role !== "super_admin") {
    return fail("Only a super admin can reopen a signed contract.");
  }

  const parsed = unlockSchema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Give a reason for reopening this contract.");
  }
  const { leadId, reason } = parsed.data;

  const lead = await leadAccessible(user, leadId);
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // Nothing to reopen on a deal nobody has signed — and saying so is better
  // than writing a permission for a lock that is not on.
  const signedAt = await dealSignedAt(user.companyId, leadId);
  if (!signedAt) return fail("This contract has not been signed, so nothing is locked.");

  const expiresAt = new Date(Date.now() + UNLOCK_WINDOW_MINUTES * 60_000);
  await prisma.solarContractUnlock.create({
    data: {
      companyId: user.companyId,
      leadId,
      reason,
      unlockedById: user.userId,
      expiresAt,
    },
  });

  /**
   * On the deal's own history, where the changes that follow will appear.
   *
   * The reason is on this line as well as on every edit made under it, so the
   * trail reads as one decision with its consequences under it rather than as
   * a series of unexplained edits.
   */
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message:
        `${user.fullName} reopened this SIGNED contract for ${UNLOCK_WINDOW_MINUTES} minutes — ` +
        `reason: ${reason}`,
      actorId: user.userId,
      leadId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const, expiresAt: expiresAt.toISOString(), reason };
}

/** Close it again before it lapses, once the change is made. */
export async function relockSignedContractAction(leadId: string) {
  const user = await requireUser();
  if (user.role !== "super_admin") return fail("Only a super admin can do that.");
  if (!(await leadAccessible(user, leadId))) return fail("Deal not found.");

  const live = await activeUnlock(user.companyId, leadId);
  if (!live) return { ok: true as const };

  /**
   * Expired, not deleted. The row is the record that an exception was made, and
   * deleting it on the way out would remove exactly the thing the reason was
   * collected for.
   */
  await prisma.solarContractUnlock.update({
    where: { id: live.id },
    data: { expiresAt: new Date() },
  });
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message: `${user.fullName} closed this contract again`,
      actorId: user.userId,
      leadId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}
