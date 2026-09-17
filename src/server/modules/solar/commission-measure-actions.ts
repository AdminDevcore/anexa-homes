"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { leadAccessible } from "@/server/rbac/lead-access";
import { freezeCommissionMeasure } from "./commission-pricing";
import { dealSignedAt } from "./signed-lock";

/**
 * Re-freezing what a signed deal's commission is measured on.
 *
 * MANUAL, SUPER ADMIN, AND IT ASKS WHY. Deliberately never automatic — least of
 * all on an unlock. Reopening a signed contract is permission to correct
 * something; it is not a decision to pay a rep differently, and the two are not
 * the same conversation. The ordinary way a change order moves pay is that the
 * household signs the new version, which re-freezes the measure by itself.
 *
 * WHAT IT DOES: reads the measure off the signed proposal again — the same code
 * the signature runs — and writes it back. Use it after a correction the
 * customer has agreed to but not re-signed, and say which correction in the
 * reason, because that reason is the whole record of why a signed deal's pay
 * moved.
 */

const fail = (error: string) => ({ ok: false as const, error });

const schema = z.object({
  leadId: z.string().min(1),
  /**
   * Required, and free text for the same reason `unlockSignedContractAction`
   * takes one: the useful reasons are specific. "Lender corrected the fee to
   * 22% after signing" tells a reader something "Correction" does not.
   */
  reason: z
    .string()
    .trim()
    .min(8, "Say why this deal's commission measure is being re-frozen.")
    .max(500),
});

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD" });

export async function refreezeCommissionMeasureAction(input: z.infer<typeof schema>) {
  const user = await requireUser();
  /**
   * SUPER ADMIN ONLY, checked here rather than only in the screen. Moving what
   * a signed deal pays on is a narrower authority than running a sales floor —
   * the same line `unlockSignedContractAction` draws.
   */
  if (user.role !== "super_admin") {
    return fail("Only a super admin can re-freeze what a commission is measured on.");
  }

  const parsed = schema.safeParse(input);
  if (!parsed.success) {
    return fail(parsed.error.issues[0]?.message ?? "Give a reason for re-freezing this measure.");
  }
  const { leadId, reason } = parsed.data;

  const lead = await leadAccessible(user, leadId);
  if (!lead) return fail("Deal not found.");
  if (lead.vertical !== "solar") return fail("This is not a solar deal.");

  // The measure is read off a signed document, so an unsigned deal has none to
  // move: payroll prices it live until the household signs.
  const signedAt = await dealSignedAt(user.companyId, leadId);
  if (!signedAt) {
    return fail("This contract has not been signed, so there is no frozen measure to move.");
  }

  const outcome = await freezeCommissionMeasure(prisma, {
    companyId: user.companyId,
    leadId,
    pricedFrom: "refreeze",
    now: new Date(),
  });
  if (outcome.status === "skipped") return fail(`Nothing to re-freeze: ${outcome.reason}.`);

  const from =
    outcome.basis === "signed_document" && outcome.proposalVersion != null
      ? `signed proposal v${outcome.proposalVersion}`
      : "the deal itself, because the signed document carries no priced figures";

  /**
   * On the deal's own history, beside the unlock that probably preceded it. The
   * numbers are in the line rather than only in the row, so the trail reads
   * without having to look the row up.
   */
  await prisma.activityLog.create({
    data: {
      companyId: user.companyId,
      type: "system",
      message:
        `${user.fullName} re-froze the commission measure from ${from}: ` +
        `${outcome.measure.systemWatts} W, base ${usd(outcome.measure.baseKeptCents)}, ` +
        `${outcome.measure.batteryQty} batteries — reason: ${reason}` +
        (outcome.differences.length > 0
          ? ` · the deal still differs: ${outcome.differences.join("; ")}`
          : ""),
      actorId: user.userId,
      leadId,
    },
  });

  revalidatePath(`/portal/leads/${leadId}`);
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return {
    ok: true as const,
    measure: outcome.measure,
    basis: outcome.basis,
    matches: outcome.matches,
    differences: outcome.differences,
  };
}
