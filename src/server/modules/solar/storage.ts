"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

/**
 * Editing the two company lists a storage quote is built from — what a battery
 * is asked to carry, and whose money comes off the price — and applying a
 * rebate to one deal.
 *
 * MUTATIONS ONLY, and every one of them resolves the company from
 * `requireUser()`. Nothing here takes a `companyId` argument, because every
 * export of a `"use server"` module is an endpoint the browser can call with
 * whatever id it likes. The reads that do take one live in `storage-queries.ts`
 * — the same split as `readiness.ts`, `adders.ts` and `layout-asset.ts`.
 */

const fail = (error: string) => ({ ok: false as const, error });

// ---------------------------------------------------------------------------
// Backup load profiles
// ---------------------------------------------------------------------------

const profileSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the profile a name.").max(60),
  /**
   * What is being backed up, watts.
   *
   * Minimum 1 because hours are `capacity ÷ load` and a zero load is an
   * infinite runtime on a customer's proposal. 50 kW is a typo rail, not a
   * policy — no house backs up more.
   */
  loadWatts: z.number().int().min(1, "A profile with no load has no runtime.").max(50_000),
  rank: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

export async function saveBackupProfileAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = profileSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid profile.");
  const d = parsed.data;

  // Scoped by companyId as well as id: an id off the wire is not proof of
  // ownership, and updateMany with both is the check and the write in one.
  if (d.id) {
    const n = await prisma.solarBackupProfile.updateMany({
      where: { id: d.id, companyId: user.companyId },
      data: { name: d.name, loadWatts: d.loadWatts, rank: d.rank, isActive: d.isActive },
    });
    if (n.count === 0) return fail("That profile no longer exists.");
    revalidatePath("/portal/settings/solar-backup");
    return { ok: true as const, id: d.id };
  }

  const existing = await prisma.solarBackupProfile.findFirst({
    where: { companyId: user.companyId, name: d.name },
    select: { id: true },
  });
  if (existing) return fail(`There is already a profile called "${d.name}".`);

  const row = await prisma.solarBackupProfile.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      loadWatts: d.loadWatts,
      rank: d.rank,
      isActive: d.isActive,
    },
    select: { id: true },
  });
  revalidatePath("/portal/settings/solar-backup");
  return { ok: true as const, id: row.id };
}

/**
 * Delete a profile.
 *
 * Deleting the last one is ALLOWED. `backupTable` returns an empty list, the
 * proposal omits the chapter and readiness blocks generation with a message
 * saying why — which is the designed behaviour, not a broken state. Refusing
 * here would only move the same conversation to a worse place.
 */
export async function deleteBackupProfileAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid profile.");
  await prisma.solarBackupProfile.deleteMany({
    where: { id: parsed.data.id, companyId: user.companyId },
  });
  revalidatePath("/portal/settings/solar-backup");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Rebates
// ---------------------------------------------------------------------------

const rebateSchema = z.object({
  id: z.string().uuid().optional(),
  name: z.string().trim().min(1, "Give the rebate a name.").max(80),
  /** Cents. A $100,000 ceiling is a typo rail — no rebate is larger. */
  amountCents: z.number().int().min(1, "A rebate of nothing is not a rebate.").max(10_000_000),
  perBattery: z.boolean(),
  rank: z.number().int().min(0).max(999),
  isActive: z.boolean(),
});

export async function saveRebateAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = rebateSchema.safeParse(input);
  if (!parsed.success) return fail(parsed.error.issues[0]?.message ?? "Invalid rebate.");
  const d = parsed.data;

  if (d.id) {
    const n = await prisma.solarRebate.updateMany({
      where: { id: d.id, companyId: user.companyId },
      data: {
        name: d.name,
        amountCents: d.amountCents,
        perBattery: d.perBattery,
        rank: d.rank,
        isActive: d.isActive,
      },
    });
    if (n.count === 0) return fail("That rebate no longer exists.");
    revalidatePath("/portal/settings/solar-rebates");
    return { ok: true as const, id: d.id };
  }

  const existing = await prisma.solarRebate.findFirst({
    where: { companyId: user.companyId, name: d.name },
    select: { id: true },
  });
  if (existing) return fail(`There is already a rebate called "${d.name}".`);

  const row = await prisma.solarRebate.create({
    data: {
      companyId: user.companyId,
      name: d.name,
      amountCents: d.amountCents,
      perBattery: d.perBattery,
      rank: d.rank,
      isActive: d.isActive,
    },
    select: { id: true },
  });
  revalidatePath("/portal/settings/solar-rebates");
  return { ok: true as const, id: row.id };
}

/**
 * Delete a rebate from the catalogue.
 *
 * REFUSED while any deal holds it, and the refusal names the count. The
 * relation is `onDelete: Restrict`, so without this the rep gets a raw foreign
 * key violation — a message that tells them nothing they can act on. Deleting
 * it would be worse: `SolarDealRebate` copies the amount, so the deals would
 * survive but their line would lose its name.
 *
 * Retiring it (`isActive: false`) is the ordinary way to take one off the list.
 */
export async function deleteRebateAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return fail("Not allowed.");
  const parsed = z.object({ id: z.string().uuid() }).safeParse(input);
  if (!parsed.success) return fail("Invalid rebate.");

  const held = await prisma.solarDealRebate.count({
    where: { rebateId: parsed.data.id, companyId: user.companyId },
  });
  if (held > 0) {
    return fail(
      `${held} ${held === 1 ? "deal is" : "deals are"} priced with this rebate. Turn it off instead of deleting it.`
    );
  }

  await prisma.solarRebate.deleteMany({
    where: { id: parsed.data.id, companyId: user.companyId },
  });
  revalidatePath("/portal/settings/solar-rebates");
  return { ok: true as const };
}

// ---------------------------------------------------------------------------
// Rebates on ONE deal
// ---------------------------------------------------------------------------

/**
 * Apply a rebate to a deal.
 *
 * The amount is COPIED off the catalogue at this moment. Editing the rebate in
 * Settings tomorrow must not move a price a rep quoted today, for the same
 * reason the proposal snapshot freezes everything else: the number the customer
 * was shown is the number they were shown.
 *
 * `qty` follows the design's battery count on a per-battery rebate and is
 * refreshed whenever the count changes — see `syncDealRebateQuantities` in
 * `storage-queries.ts`.
 */
export async function applyDealRebateAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = z
    .object({ leadId: z.string().min(1), rebateId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid rebate.");
  const { leadId, rebateId } = parsed.data;

  const [rebate, design] = await Promise.all([
    prisma.solarRebate.findFirst({
      where: { id: rebateId, companyId: user.companyId, isActive: true },
      select: { amountCents: true, perBattery: true },
    }),
    prisma.solarDesign.findFirst({
      where: { leadId, companyId: user.companyId },
      select: { batteryQty: true, batteryId: true },
    }),
  ]);
  if (!rebate) return fail("That rebate is no longer available.");
  if (!design?.batteryId) return fail("Pick a battery before applying a battery rebate.");

  const qty = rebate.perBattery ? Math.max(1, design.batteryQty) : 1;

  await prisma.solarDealRebate.upsert({
    where: { leadId_rebateId: { leadId, rebateId } },
    create: {
      companyId: user.companyId,
      leadId,
      rebateId,
      qty,
      amountCents: rebate.amountCents,
    },
    // Re-applying refreshes the copy. That is the ONE place a catalogue edit is
    // allowed to reach a deal, and it takes a deliberate click to do it.
    update: { qty, amountCents: rebate.amountCents },
  });
  revalidatePath(`/portal/leads/${leadId}/solar-proposal`);
  return { ok: true as const };
}

export async function removeDealRebateAction(input: unknown) {
  const user = await requireUser();
  if (!can(user, "update", "Lead")) return fail("Not allowed.");
  const parsed = z
    .object({ leadId: z.string().min(1), rebateId: z.string().uuid() })
    .safeParse(input);
  if (!parsed.success) return fail("Invalid rebate.");
  await prisma.solarDealRebate.deleteMany({
    where: { leadId: parsed.data.leadId, rebateId: parsed.data.rebateId, companyId: user.companyId },
  });
  revalidatePath(`/portal/leads/${parsed.data.leadId}/solar-proposal`);
  return { ok: true as const };
}
