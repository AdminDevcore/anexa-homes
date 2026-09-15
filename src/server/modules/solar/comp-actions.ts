"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { leadAccessible } from "@/server/rbac/lead-access";
import { establishHistoricalComp } from "./deal-comp";

/**
 * The one way an admin can unblock a signed deal whose pay terms cannot be read.
 *
 * WHY THIS EXISTS AS AN ACTION. The engine REFUSES to pay a signed deal that
 * has no usable snapshot — it will not fall back to the rep's settings as they
 * stand today, because those are not the terms the deal was sold under and
 * paying on them invents a number nobody agreed to. That refusal is correct and
 * it is also a dead end: without a way in from the browser, a flagged deal
 * could only ever be freed by somebody writing SQL against production.
 *
 * WHAT IT WILL NOT DO. It cannot overwrite terms that resolved properly at
 * signing (`establishHistoricalComp` refuses), it demands a written reason, and
 * it writes an ActivityLog entry naming the person, the basis and the reason. A
 * number typed in after the fact is only defensible if it is attributable.
 */

const termsSchema = z
  .object({
    leadId: z.string().min(1),
    note: z.string().min(3).max(500),
    basis: z.enum(["redline", "per_watt", "battery_redline", "battery_flat"]),
    /** Cents per watt of margin above the rep's redline. */
    redlineCentsPerWatt: z.number().int().min(0).nullable().default(null),
    /** Mills (tenths of a cent) per watt on a fixed rate. */
    millsPerWatt: z.number().int().min(0).nullable().default(null),
    /** Cents of margin per battery, storage-only deals. */
    redlinePerBatteryCents: z.number().int().min(0).nullable().default(null),
    /** Flat cents per battery, storage-only deals. */
    perBatteryFlatCents: z.number().int().min(0).nullable().default(null),
  })
  .refine(
    (v) =>
      (v.basis === "redline" && v.redlineCentsPerWatt != null) ||
      (v.basis === "per_watt" && v.millsPerWatt != null) ||
      (v.basis === "battery_redline" && v.redlinePerBatteryCents != null) ||
      (v.basis === "battery_flat" && v.perBatteryFlatCents != null),
    { message: "Enter the rate for the basis you chose." }
  );

export async function establishHistoricalCompAction(input: z.infer<typeof termsSchema>) {
  const user = await requireUser();
  // Approving commissions is the authority that matters here: this decides what
  // a person is paid on a deal that has already closed.
  if (!can(user, "approve", "Commission")) return { ok: false as const, error: "Not allowed." };

  const parsed = termsSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid terms." };
  }
  const d = parsed.data;
  if (!(await leadAccessible(user, d.leadId))) return { ok: false as const, error: "Deal not found." };

  const res = await establishHistoricalComp({
    companyId: user.companyId,
    leadId: d.leadId,
    actorId: user.userId,
    note: d.note,
    terms: {
      basis: d.basis,
      redlineCentsPerWatt: d.redlineCentsPerWatt,
      millsPerWatt: d.millsPerWatt,
      redlinePerBatteryCents: d.redlinePerBatteryCents,
      perBatteryFlatCents: d.perBatteryFlatCents,
    },
  });
  if (!res.ok) return { ok: false as const, error: res.error ?? "Could not establish these terms." };

  revalidatePath("/portal/commissions");
  revalidatePath(`/portal/leads/${d.leadId}`);
  return { ok: true as const };
}
