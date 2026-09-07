import { prisma } from "@/server/db/client";
import { DEFAULT_BATTERY_QTY } from "./settings";

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

/**
 * What the battery slot should say once a deal has declared its system type.
 *
 * The third star, and until now the only decorative one: `isDefault` on a
 * battery sorted the picker and did nothing else, so a company that had chosen
 * its standard battery still watched every rep pick it by hand — or not, and
 * quote a solar-plus-storage system with no storage in it.
 *
 * It cannot follow the module's rule of "fill an empty slot whenever the
 * figures are recomputed", because that rule would put a battery on every deal
 * in the pipeline: storage is a sales decision, not an approved-vendor one, and
 * most deals do not have any. So the trigger is narrower and it is the rep's
 * own: the moment the deal is set to solar + storage or storage only, an empty
 * slot takes the default at the company's standard quantity.
 *
 * The three outcomes, in the order they are decided:
 *
 *   - solar only  → the slot is CLEARED, count and all. A battery left behind
 *                   on a deal quoting panels prices storage nobody is selling.
 *   - slot filled → untouched. A default that overwrites a rep's own pick is
 *                   not a default, it is a correction.
 *   - slot empty  → the active default, at `defaultBatteryQty`. No default
 *                   starred means no change, not a guess at a product.
 *
 * Returns a patch to spread into the design's update — `{}` when there is
 * nothing to say, so a caller never writes a column it did not decide.
 *
 * `SolarEquipment` and `SolarSettings` are SCOPED models, so callers outside a
 * portal session must wrap this in `runInVertical("solar", …)`.
 */
export async function resolveDesignBattery(
  companyId: string,
  systemType: "pv" | "pv_storage" | "storage",
  existingBatteryId: string | null,
  existingBatteryQty: number
): Promise<{ batteryId?: string | null; batteryQty?: number }> {
  if (systemType === "pv") {
    // Already empty is already right — and writing nothing keeps a design that
    // never had storage out of the "changed" set entirely.
    return existingBatteryId || existingBatteryQty > 0
      ? { batteryId: null, batteryQty: 0 }
      : {};
  }

  if (existingBatteryId) return {};

  const [battery, settings] = await Promise.all([
    prisma.solarEquipment.findFirst({
      where: { companyId, kind: "battery", isActive: true, isDefault: true },
      select: { id: true },
    }),
    prisma.solarSettings.findUnique({
      where: { companyId },
      select: { defaultBatteryQty: true },
    }),
  ]);
  if (!battery) return {};

  return {
    batteryId: battery.id,
    batteryQty: Math.max(1, settings?.defaultBatteryQty ?? DEFAULT_BATTERY_QTY),
  };
}
