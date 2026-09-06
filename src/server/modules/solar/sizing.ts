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

/**
 * Which inverter a design is built with.
 *
 * The same rule as the panel above, and for the same reason: a rep does not
 * choose hardware on a sales call, the approved-vendor list does. A design that
 * already names an inverter KEEPS it; one that names none takes the
 * catalogue's active default.
 *
 * Until this existed the star on an inverter was decoration. It sorted the
 * picker and nothing else, so `inverterId` stayed null on every deal unless a
 * rep opened the system picker and chose one by hand — which is not something
 * a rep has any reason to do, because none of their own screens ask for it and
 * no figure they watch moves when they do. The first thing that noticed was
 * the lender, at the worst possible moment: Amos will not take an application
 * with no inverter on it, so the customer's own Qualify button read "the
 * design has no inverter selected" on a company that had starred one.
 *
 * Only the id, because unlike the module nothing is DERIVED from the inverter —
 * it is a fact about what gets installed, carried onto the customer's document
 * and into the lender's bill of materials. Returns null when there is no
 * default to use, which leaves the slot exactly as empty as it was rather than
 * guessing at a product.
 */
export async function resolveDesignInverter(
  companyId: string,
  existingInverterId: string | null
): Promise<{ id: string } | null> {
  const select = { id: true } as const;

  if (existingInverterId) {
    const kept = await prisma.solarEquipment.findFirst({
      where: { companyId, id: existingInverterId, kind: "inverter" },
      select,
    });
    if (kept) return kept;
  }

  return prisma.solarEquipment.findFirst({
    where: { companyId, kind: "inverter", isActive: true, isDefault: true },
    select,
  });
}
