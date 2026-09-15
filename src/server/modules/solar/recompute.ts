import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { resolveSizingModule, resolveDesignInverter, resolveAutoBatteryQty } from "./sizing";
import { applyAutoAdders, recomputeAdderTotal } from "./adders";
import { planeFor, resolvePlaneYields } from "./pvwatts";
import { groundPlanesFor, resolveRoofPlanes } from "./roof-planes";
import { applyPlanes } from "@/lib/solar-roof-planes";
import { applyFootprintFacing } from "@/lib/solar-footprint";
import { resolveFootprintFacing } from "./footprint";
import { yieldCacheKey } from "@/lib/solar-pvwatts";
import {
  blockPanelCount,
  panelCount,
  parseLayoutBlocks,
  MODULE_FALLBACK_MM,
  type LayoutBlock,
} from "@/lib/solar-layout";
import { systemTotals } from "@/lib/solar-arrays";
import { offsetPct } from "@/lib/solar-money";
import { effectiveUsageKwh } from "@/lib/solar-energy";
import { recomputeDealMoney } from "./deal-money";

/**
 * Everything the design's stored figures are derived from, in one place.
 *
 * Two different edits move these numbers and both have to move them the SAME
 * way: drawing on the roof changes the panel count, and choosing a different
 * module changes what each of those panels is worth. Before this existed only
 * the layout save recomputed, so picking a 440 W panel on a deal drawn with
 * 400 W ones left the system size, the production, the offset and the per-watt
 * price all describing the panel that was replaced.
 *
 * Writes `moduleQty`, `systemSizeKwDc`, `year1ProductionKwh`, `offsetPct` and
 * the record of which yield model answered — never anything a rep typed.
 *
 * ALSO the place the catalogue's starred hardware lands on the deal, for both
 * the module and the inverter. Here rather than at the seven places a design
 * row gets created, because that is seven chances to forget one — and the
 * inverter WAS forgotten at all seven, which is how a company that had starred
 * an inverter still sent deals to its lender with the slot empty.
 */
export async function recomputeDesignFigures(companyId: string, leadId: string) {
  const [lead, design] = await Promise.all([
    prisma.lead.findFirst({
      where: { companyId, id: leadId },
      // The coordinate is the site: `lat` drives the sun's path for the
      // fallback model, both together are what PVWatts simulates.
      select: { lat: true, lng: true },
    }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: {
        layoutBlocks: true,
        moduleId: true,
        inverterId: true,
        annualUsageKwh: true,
        usageAdjustmentKwh: true,
        mountType: true,
        // For the battery count, which follows the production computed below.
        systemType: true,
        batteryId: true,
        batteryQty: true,
        batteryQtySetByRep: true,
      },
    }),
  ]);
  if (!lead || !design) return null;

  const stored: LayoutBlock[] = parseLayoutBlocks(design.layoutBlocks);
  const assumptions = await getSolarSettings(companyId);
  const [module_, inverter] = await Promise.all([
    resolveSizingModule(companyId, design.moduleId),
    resolveDesignInverter(companyId, design.inverterId),
  ]);
  const arrayType = design.mountType === "ground" ? ("ground" as const) : ("roof" as const);

  /**
   * Give every array nobody has described the angles of the plane it sits on.
   *
   * BEFORE the yields are asked for, because the whole point is that PVWatts
   * then has a real plane to simulate instead of the array falling through to
   * the company's market average. An array a rep described is untouched, and a
   * roof Google cannot see leaves everything exactly as it was.
   *
   * Ground mounts are skipped: they sit in a yard, not on a plane, and the
   * nearest roof segment has nothing to do with how they were racked.
   */
  const wantsFacing = stored.some(
    (b) => blockPanelCount(b) > 0 && (b.azimuthDeg == null || b.tiltDeg == null)
  );
  // Nothing to fill is not a question worth asking. A design where every array
  // is already described would otherwise spend a Google request on every save
  // to be told what it is not going to use.
  const roof =
    arrayType === "ground" || !wantsFacing
      ? null
      : await resolveRoofPlanes(lead.lat, lead.lng);
  const read = applyPlanes(
    stored,
    groundPlanesFor(roof, lead.lat, lead.lng),
    {
      widthMm: module_?.widthMm ?? MODULE_FALLBACK_MM.widthMm,
      heightMm: module_?.heightMm ?? MODULE_FALLBACK_MM.heightMm,
    }
  );

  /**
   * Whatever the roof could not answer, ask the building's outline.
   *
   * AFTER `applyPlanes` and never instead of it. Google's model is per plane
   * and knows a hip from a gable; this is one ridge for the whole house. So it
   * only ever reaches arrays that would otherwise have gone to PVWatts with no
   * facing at all — which is to say, gone to the flat market average and quietly
   * lost a fifth of the production on a south roof.
   *
   * Ground mounts are skipped for the same reason they skip the roof: a rack in
   * a yard is aimed, not built onto a slope.
   *
   * The pitch is NOT filled from this, so an array with no tilt is still
   * unpriced afterwards. That is deliberate — see `applyFootprintFacing`.
   */
  const stillUnfaced =
    arrayType !== "ground" &&
    read.blocks.some((b) => blockPanelCount(b) > 0 && b.azimuthDeg == null);
  const ridge = stillUnfaced ? await resolveFootprintFacing(lead.lat, lead.lng) : null;
  const outline = applyFootprintFacing(read.blocks, ridge);

  const blocks = outline.blocks;

  const plane = (tiltDeg: number | null, azimuthDeg: number | null) =>
    planeFor({
      lat: lead.lat,
      lon: lead.lng,
      tiltDeg,
      azimuthDeg,
      derateFactor: assumptions.derateFactor,
      arrayType,
    });

  // Ask NREL what each described plane makes. Deduplicated by plane, cached
  // across companies, and never fatal — an unanswered plane keeps the market
  // average and the design records that it did.
  const yields = await resolvePlaneYields(
    blocks.map((b) => plane(b.tiltDeg ?? null, b.azimuthDeg ?? null)).filter((p) => p !== null)
  );

  const totals = systemTotals(blocks, {
    lat: lead.lat,
    moduleRatingW: module_?.ratingW ?? null,
    assumptions,
    planeYield: ({ tiltDeg, azimuthDeg }) => {
      const p = plane(tiltDeg, azimuthDeg);
      return p ? (yields.get(yieldCacheKey(p))?.kwhPerKwYear ?? null) : null;
    },
  });

  const station = [...yields.values()].map((y) => y.station).find(Boolean) ?? null;
  // Against the usage the system actually has to cover — the bill figure PLUS
  // whatever the adders on this deal will add to it. Quoting offset against the
  // bill alone promises coverage the array was never sized for on any deal that
  // sells an EV charger.
  const usageKwh = effectiveUsageKwh(design.annualUsageKwh, design.usageAdjustmentKwh);
  const computedOffset = usageKwh ? offsetPct(totals.year1ProductionKwh, usageKwh) : 0;

  /**
   * How many batteries the night now needs.
   *
   * HERE, because the production it is measured against is the number this
   * function just worked out — a roof redrawn from 20,000 to 34,000 kWh is a
   * bigger night to carry, and a count decided once when storage landed on the
   * deal would still be quoting the smaller array's answer. This is the same
   * argument the module and the inverter are resolved here for: the derived
   * figures belong wherever the figures they derive from are written.
   *
   * Against the production TOTALS rather than the stored column, which has not
   * been written yet. Null — the switch is off, a rep typed the count, nothing
   * to size from — leaves `batteryQty` out of the update entirely.
   */
  const sizedBattery = await resolveAutoBatteryQty(companyId, {
    systemType: design.systemType,
    batteryId: design.batteryId,
    batteryQtySetByRep: design.batteryQtySetByRep,
    year1ProductionKwh: totals.year1ProductionKwh,
    annualUsageKwh: design.annualUsageKwh,
    usageAdjustmentKwh: design.usageAdjustmentKwh,
  });

  await prisma.solarDesign.update({
    where: { leadId },
    data: {
      // Written back ONLY when something supplied a facing — the roof OR the
      // building outline — so this stays a figures recompute for every other
      // design. The geometry is untouched either way: the same rectangles, now
      // with a facing on them. Testing `read.filled` alone would compute the
      // outline's answer, price the design on it, and then throw the facing
      // away, so the next save would ask again and the block would stay blank
      // for ever.
      ...(read.filled + outline.filled > 0 ? { layoutBlocks: blocks } : {}),
      moduleQty: panelCount(blocks),
      // Only when one resolved. Writing null here would unpick a module a rep
      // chose the moment the catalogue has no default to fall back to.
      ...(module_ ? { moduleId: module_.id } : {}),
      // Same rule, same reason — and it resolves to whatever the design already
      // names before it ever looks at the star, so this can only ever FILL an
      // empty slot. It never re-points a deal at this year's product.
      ...(inverter ? { inverterId: inverter.id } : {}),
      systemSizeKwDc: totals.systemSizeKwDc,
      year1ProductionKwh: totals.year1ProductionKwh,
      offsetPct: computedOffset,
      yieldSource: totals.measuredArrays > 0 ? "pvwatts" : null,
      yieldStation: totals.measuredArrays > 0 ? station : null,
      yieldArrays: totals.measuredArrays,
      // Only when it moved. Writing the same count back would put every storage
      // design in the "updated" set on a recompute that changed nothing.
      ...(sizedBattery && sizedBattery.qty !== design.batteryQty
        ? { batteryQty: sizedBattery.qty }
        : {}),
    },
  });

  // The size just moved, so the adders that are TRIGGERED by size have to be
  // re-decided before they are re-priced: a small-system charge comes off the
  // moment the roof turns out to hold six kilowatts, and a steep-roof rate that
  // is still in play is worth more on the bigger array.
  const auto = await applyAutoAdders(companyId, leadId);

  // A per-watt adder is a rate, so anything that changes the system size
  // reprices it — a bigger panel on the same roof is a bigger steep-roof
  // charge, and leaving the cached total alone is the staleness the typed
  // "Adders $" box had, one level deeper.
  await recomputeAdderTotal(companyId, leadId, { force: auto.added.length + auto.removed.length > 0 });

  /**
   * AND THE CONTRACT, which every figure above is an input to.
   *
   * This is the chokepoint for a design that moved — the equipment picker, the
   * layout designer, the design save and the live re-price all end here — so it
   * is the one place that can guarantee the cached money never trails the
   * system it is a price for. Without it a roof redrawn from 12 kW to 16 kW
   * left `contractPriceCents` quoting the old array, which is what a lender
   * submission reads as the amount to underwrite.
   *
   * Only DERIVED columns move; nothing a person typed is rewritten. See
   * `recomputeDealMoney`.
   */
  await recomputeDealMoney(companyId, leadId);

  return {
    moduleQty: panelCount(blocks),
    systemSizeKwDc: totals.systemSizeKwDc,
    year1ProductionKwh: totals.year1ProductionKwh,
    offsetPct: computedOffset,
    measuredArrays: totals.measuredArrays,
    /**
     * The battery count auto-sizing settled on, or null when it did not run.
     *
     * Returned for the same reason `autoAdders` is: the number on the rep's
     * screen changed without them typing anything, and on a storage deal that
     * is money. The designer says what moved and what it was measured from.
     */
    battery: sizedBattery,
    /** How many arrays took their angles off the building, so the screen can say. */
    filledFromRoof: read.filled,
    /**
     * How many took a facing from the building's OUTLINE instead.
     *
     * Counted separately, never added to the one above. They are different
     * claims — one is measured off the roof, the other inferred from the shape
     * of the house — and a screen that reported "5 arrays read from the roof"
     * for a number that was partly guessed would be making the stronger claim
     * on the weaker evidence.
     */
    filledFromOutline: outline.filled,
    /**
     * The adders the size rule put on or took off, by name.
     *
     * Returned rather than left silent because money appeared on the deal that
     * the rep did not type. A line nobody can account for is the exact
     * complaint the itemised adders were built to answer.
     */
    autoAdders: auto,
  };
}
