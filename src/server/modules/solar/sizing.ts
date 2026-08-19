import { prisma } from "@/server/db/client";

/**
 * Which panel a design is sized from.
 *
 * Deliberately its own module rather than a function inside `actions.ts`: the
 * actions file imports the session, which pulls next-auth, which the DB-backed
 * test suite cannot load. Sizing is data resolution with no notion of a user,
 * so it belongs on this side of that line — and the rule it encodes is worth
 * testing directly.
 *
 * A rep does not choose hardware on a sales call — the approved-vendor list
 * does, once a year — so a design with no module takes the catalogue's active
 * default. A design that ALREADY has one KEEPS it: re-pointing an existing
 * quote at this year's panel would silently change a price somebody has already
 * been shown.
 *
 * Returns null when there is no default to use, which validation turns into a
 * blocking issue pointing at the catalogue rather than at the rep.
 *
 * `SolarEquipment` is a SCOPED model, so callers outside a portal session must
 * wrap this in `runInVertical("solar", …)`.
 */
export async function resolveSizingModule(
  companyId: string,
  existingModuleId: string | null
): Promise<{ id: string; ratingW: number | null; widthMm: number | null; heightMm: number | null } | null> {
  const select = { id: true, ratingW: true, widthMm: true, heightMm: true } as const;

  if (existingModuleId) {
    const kept = await prisma.solarEquipment.findFirst({
      where: { companyId, id: existingModuleId, kind: "module" },
      select,
    });
    if (kept) return kept;
  }

  return prisma.solarEquipment.findFirst({
    where: { companyId, kind: "module", isActive: true, isDefault: true },
    select,
  });
}
