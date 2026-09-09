import { prisma } from "@/server/db/client";
import type { BackupProfile } from "@/lib/solar-storage";

/**
 * Reading the company's backup load profiles — what a battery is asked to
 * carry, and therefore how long it carries it.
 *
 * Deliberately NOT in `storage.ts`: that file is `"use server"`, so every export
 * from it is an endpoint the browser can call with whatever `companyId` it
 * likes. Every function here takes a `companyId` argument, which is exactly the
 * shape that must not be reachable that way. Callers pass the id they already
 * resolved from the session.
 *
 * Same reasoning, and the same split, as `readiness.ts`, `adders.ts`,
 * `layout-asset.ts` and `esign/final-docs.ts`. The mutations that a browser
 * legitimately calls stay in `storage.ts`, where they resolve the company from
 * `requireUser()` and never take one as an argument.
 *
 * `SolarBackupProfile` carries a `vertical` column but is NOT registered in
 * `server/vertical/models.ts`, so the isolation extension adds no filter of its
 * own here. The `companyId` the caller passes is the boundary these reads have,
 * which is the other half of why it must come from the session rather than off
 * the wire.
 */

// ---------------------------------------------------------------------------
// Backup load profiles
// ---------------------------------------------------------------------------

export type BackupProfileRow = BackupProfile & { isActive: boolean };

/**
 * The company's load profiles.
 *
 * `activeOnly` for anything a customer will read — a retired profile must not
 * appear on a proposal. The settings screen passes false so it can show and
 * revive one.
 */
export async function listBackupProfiles(
  companyId: string,
  activeOnly = true
): Promise<BackupProfileRow[]> {
  const rows = await prisma.solarBackupProfile.findMany({
    where: { companyId, ...(activeOnly ? { isActive: true } : {}) },
    orderBy: [{ rank: "asc" }, { loadWatts: "asc" }],
    select: { id: true, name: true, loadWatts: true, rank: true, isActive: true },
  });
  return rows;
}
