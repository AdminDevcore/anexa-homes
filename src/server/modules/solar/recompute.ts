import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { recomputeAdderTotal } from "./adders";
import { planeFor, resolvePlaneYields } from "./pvwatts";
import { groundPlanesFor, resolveRoofPlanes } from "./roof-planes";
import { applyPlanes } from "@/lib/solar-roof-planes";
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
        annualUsageKwh: true,
        mountType: true,
      },
    }),
  ]);
  if (!lead || !design) return null;

  const stored: LayoutBlock[] = parseLayoutBlocks(design.layoutBlocks);
  const assumptions = await getSolarSettings(companyId);
  const module_ = await resolveSizingModule(companyId, design.moduleId);
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
  const blocks = read.blocks;

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
  const computedOffset = design.annualUsageKwh
    ? offsetPct(totals.year1ProductionKwh, design.annualUsageKwh)
    : 0;

  await prisma.solarDesign.update({
    where: { leadId },
    data: {
      // Written back ONLY when the roof supplied something, so this stays a
      // figures recompute for every other design. The geometry is untouched
      // either way — the same rectangles, now with a facing on them.
      ...(read.filled > 0 ? { layoutBlocks: blocks } : {}),
      moduleQty: panelCount(blocks),
      // Only when one resolved. Writing null here would unpick a module a rep
      // chose the moment the catalogue has no default to fall back to.
      ...(module_ ? { moduleId: module_.id } : {}),
      systemSizeKwDc: totals.systemSizeKwDc,
      year1ProductionKwh: totals.year1ProductionKwh,
      offsetPct: computedOffset,
      yieldSource: totals.measuredArrays > 0 ? "pvwatts" : null,
      yieldStation: totals.measuredArrays > 0 ? station : null,
      yieldArrays: totals.measuredArrays,
    },
  });

  // A per-watt adder is a rate, so anything that changes the system size
  // reprices it — a bigger panel on the same roof is a bigger steep-roof
  // charge, and leaving the cached total alone is the staleness the typed
  // "Adders $" box had, one level deeper.
  await recomputeAdderTotal(companyId, leadId);

  return {
    moduleQty: panelCount(blocks),
    systemSizeKwDc: totals.systemSizeKwDc,
    year1ProductionKwh: totals.year1ProductionKwh,
    offsetPct: computedOffset,
    measuredArrays: totals.measuredArrays,
    /** How many arrays took their angles off the building, so the screen can say. */
    filledFromRoof: read.filled,
  };
}
