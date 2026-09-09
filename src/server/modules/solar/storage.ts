"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";

/**
 * Editing the company's backup load profiles — what a battery is asked to
 * carry, which is the whole of what a storage quote is configured from.
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
    revalidatePath("/portal/settings/solar");
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
  revalidatePath("/portal/settings/solar");
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
  revalidatePath("/portal/settings/solar");
  return { ok: true as const };
}
