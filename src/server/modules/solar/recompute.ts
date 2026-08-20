import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { recomputeAdderTotal } from "./adders";
import { planeFor, resolvePlaneYields } from "./pvwatts";
import { yieldCacheKey } from "@/lib/solar-pvwatts";
import { panelCount, parseLayoutBlocks, type LayoutBlock } from "@/lib/solar-layout";
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

  const blocks: LayoutBlock[] = parseLayoutBlocks(design.layoutBlocks);
  const assumptions = await getSolarSettings(companyId);
  const module_ = await resolveSizingModule(companyId, design.moduleId);
  const arrayType = design.mountType === "ground" ? ("ground" as const) : ("roof" as const);

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
  };
}
