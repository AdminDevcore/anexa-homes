import { prisma } from "@/server/db/client";
import { getSolarSettings } from "./settings";
import { resolveSizingModule } from "./sizing";
import { planeFor, cachedPlaneYields } from "./pvwatts";
import { yieldCacheKey } from "@/lib/solar-pvwatts";
import { parseLayoutBlocks } from "@/lib/solar-layout";
import { arrayBreakdown, monthlyProduction } from "@/lib/solar-arrays";

/**
 * Twelve months of production for one design, or nothing.
 *
 * READS THE CACHE ONLY. Generating a proposal must not sit on a rate-limited
 * simulation the layout save has already paid for: `recomputeDesignFigures`
 * fetches and stores every plane on the design the moment it is saved, so by
 * the time anybody generates a document the answers are there. A cache miss —
 * a design saved before the cache existed, a row that has aged out — leaves the
 * chart off the proposal rather than holding up the generation for it.
 *
 * Null is the ordinary answer for a great many designs, and every caller has to
 * treat it as one. See `monthlyProduction` for the rule about mixed roofs.
 */
export async function monthlyProductionForDesign(
  companyId: string,
  leadId: string
): Promise<number[] | null> {
  const [lead, design] = await Promise.all([
    prisma.lead.findFirst({ where: { companyId, id: leadId }, select: { lat: true, lng: true } }),
    prisma.solarDesign.findUnique({
      where: { leadId },
      select: { layoutBlocks: true, moduleId: true, mountType: true },
    }),
  ]);
  if (!lead || !design) return null;

  const blocks = parseLayoutBlocks(design.layoutBlocks);
  if (blocks.length === 0) return null;

  const [assumptions, module_] = await Promise.all([
    getSolarSettings(companyId),
    resolveSizingModule(companyId, design.moduleId),
  ]);
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

  const yields = await cachedPlaneYields(
    blocks.map((b) => plane(b.tiltDeg ?? null, b.azimuthDeg ?? null)).filter((p) => p !== null)
  );

  const arrays = arrayBreakdown(blocks, {
    lat: lead.lat,
    moduleRatingW: module_?.ratingW ?? null,
    planeYield: ({ tiltDeg, azimuthDeg }) => {
      const p = plane(tiltDeg, azimuthDeg);
      return p ? (yields.get(yieldCacheKey(p))?.kwhPerKwYear ?? null) : null;
    },
  });

  return monthlyProduction(arrays, ({ tiltDeg, azimuthDeg }) => {
    const p = plane(tiltDeg, azimuthDeg);
    if (!p) return null;
    const hit = yields.get(yieldCacheKey(p));
    return hit && hit.monthly.length === 12 ? hit.monthly : null;
  });
}

/** Twelve readings off the design, or null. Never a padded or partial year. */
export function readMonthlyUsage(raw: unknown): number[] | null {
  if (!Array.isArray(raw) || raw.length !== 12) return null;
  const out = raw.map((n) => (typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : -1));
  if (out.some((n) => n < 0)) return null;
  return out.some((n) => n > 0) ? out.map((n) => Math.round(n)) : null;
}
