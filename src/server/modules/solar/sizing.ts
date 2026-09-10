import { prisma } from "@/server/db/client";
import { autoBatteryCount, autoBatteryBasisKwh, type AutoBatterySizing } from "@/lib/solar-storage";
import { AUTO_BATTERY_DEFAULTS, DEFAULT_BATTERY_QTY } from "./settings";

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
  existingBatteryQty: number,
  /**
   * The figures auto-sizing needs, when the caller has them.
   *
   * Optional so the rule below is unchanged for a caller that does not: no
   * figures means no auto-sizing, and the company's flat count lands exactly as
   * it always did.
   */
  figures?: {
    year1ProductionKwh: number;
    annualUsageKwh: number | null;
    usageAdjustmentKwh: number;
  }
): Promise<{ batteryId?: string | null; batteryQty?: number; batteryQtySetByRep?: boolean }> {
  if (systemType === "pv") {
    // Already empty is already right — and writing nothing keeps a design that
    // never had storage out of the "changed" set entirely.
    //
    // The rep's own count goes with it. A deal coming back to storage later is
    // a fresh decision about storage, and honouring a count typed against a
    // battery that has since been taken off would lock the new one out of
    // auto-sizing for a number nobody remembers choosing.
    return existingBatteryId || existingBatteryQty > 0
      ? { batteryId: null, batteryQty: 0, batteryQtySetByRep: false }
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

  const flat = Math.max(1, settings?.defaultBatteryQty ?? DEFAULT_BATTERY_QTY);

  /**
   * Size it to the night on the way in, so the FIRST count a rep sees is right.
   *
   * Leaving it to the next recompute would work — nothing about this deal is
   * final yet — but it would put the company's flat two on the screen first and
   * change it under the rep a moment later, which reads as a bug whichever
   * number turns out to be correct. Null falls through to the flat count, which
   * is the honest answer on a deal that has no figures to size from yet.
   */
  const sized = figures
    ? await resolveAutoBatteryQty(companyId, {
        systemType,
        batteryId: battery.id,
        batteryQtySetByRep: false,
        ...figures,
      })
    : null;

  return {
    batteryId: battery.id,
    batteryQty: sized?.qty ?? flat,
  };
}

/**
 * What the battery COUNT should be on a deal that auto-sizes.
 *
 * The flat "two batteries" a company sets is an answer to the wrong question.
 * Two is right for the house it was chosen for and wrong for the one next door,
 * because what a battery has to do is carry the night — and the night is a
 * property of the home's own consumption, not of the company's price list. So
 * with the switch on, the count is DERIVED:
 *
 *     night kWh/day = the year's kWh ÷ 365 × the company's night share
 *     batteries     = ceil(night kWh/day ÷ this battery's usable kWh)
 *
 * WHICH kWh depends on what the deal sells. A solar-plus-storage deal is sized
 * off its PRODUCTION, because that is the energy the battery is being asked to
 * time-shift — and a 60%-offset array cannot charge storage for a night it
 * never made the power for. A storage-only deal makes no kilowatt-hours at all,
 * so it is sized off what the house USES, adders included. Sizing that deal off
 * production would quote one battery to every house on the street.
 *
 * Returns null — leave the count alone — in every case where the answer would
 * be a guess:
 *
 *   - the switch is off                → the flat default is the company's answer
 *   - the deal quotes panels only      → there is no battery to count
 *   - the slot is empty                → nothing to size
 *   - a REP TYPED THE COUNT            → their number is the answer, not ours
 *   - the catalogue has no capacity    → a battery with no kWh cannot be divided into
 *   - no production and no usage yet   → a brand-new deal; the next recompute
 *                                        will have something to work with
 *
 * `SolarSettings` and `SolarEquipment` are SCOPED models, so callers outside a
 * portal session must wrap this in `runInVertical("solar", …)`.
 */
export async function resolveAutoBatteryQty(
  companyId: string,
  design: {
    systemType: "pv" | "pv_storage" | "storage";
    batteryId: string | null;
    batteryQtySetByRep?: boolean;
    year1ProductionKwh: number;
    annualUsageKwh: number | null;
    usageAdjustmentKwh: number;
  }
): Promise<AutoBatterySizing | null> {
  if (design.systemType === "pv") return null;
  if (!design.batteryId) return null;
  if (design.batteryQtySetByRep) return null;

  const settings = await prisma.solarSettings.findUnique({
    where: { companyId },
    select: { autoBatteryQty: true, batteryNightSharePct: true },
  });
  const autoOn = settings?.autoBatteryQty ?? AUTO_BATTERY_DEFAULTS.autoBatteryQty;
  if (!autoOn) return null;

  const battery = await prisma.solarEquipment.findFirst({
    where: { companyId, id: design.batteryId, kind: "battery" },
    select: { ratingW: true },
  });
  if (!battery) return null;

  return autoBatteryCount({
    // Production on a deal that has an array, usage on one that does not —
    // see `autoBatteryBasisKwh`, which the deal screen reads too.
    basisKwh: autoBatteryBasisKwh(design),
    nightSharePct: settings?.batteryNightSharePct ?? AUTO_BATTERY_DEFAULTS.batteryNightSharePct,
    batteryRatingWh: battery.ratingW,
  });
}
