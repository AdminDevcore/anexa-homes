/**
 * One-off: bring every SAVED solar design onto the current production maths.
 *
 * A design's `year1ProductionKwh` is a STORED number — computed when the layout
 * was last saved and read straight off the row by the deal page, the offset,
 * the proposal builder and the auto-adder rules. So changing how production is
 * computed (the 5% production margin in `PRODUCTION_MARGIN_PCT`, a company's
 * derate, anything else in the model) moves new designs immediately and leaves
 * every existing one quoting the old figure until somebody happens to re-save
 * it. This walks them all and recomputes.
 *
 * RECOMPUTES, never scales. It rebuilds the figure from the design's own
 * geometry with the same `systemTotals` the app uses, so running it twice
 * produces the same answer as running it once — a script that multiplied the
 * stored kWh by 0.95 would take another 5% off every time somebody ran it.
 *
 * NO NETWORK. Plane yields come from `SolarYieldCache` only: a design drawn on
 * a plane that has been simulated keeps its PVWatts figure, and one that has
 * not falls to the company's market average exactly as the live path would
 * before its first save. Nothing here spends a rate-limited NLR request, and
 * nothing here stalls on a dead API.
 *
 * ONLY the two derived figures: `year1ProductionKwh` and `offsetPct`. Geometry,
 * module, size, adders and anything a rep typed are untouched — this is not
 * `recomputeDesignFigures`, which also re-reads the roof and re-decides
 * size-triggered adders, and which would therefore move money on deals nobody
 * asked it to.
 *
 * ALREADY-GENERATED PROPOSALS DO NOT MOVE. A proposal is a frozen snapshot of
 * what a customer was shown; it keeps the number it was built with, and the
 * rep re-prices it deliberately. This only changes what the NEXT proposal off
 * a design will say.
 *
 *   npx tsx scripts/reprice-production.ts            # report only, writes nothing
 *   npx tsx scripts/reprice-production.ts --apply    # write the new figures
 *
 * DATABASE_URL must point at the environment you mean.
 */
import { PrismaClient } from "@prisma/client";
import { systemTotals } from "../src/lib/solar-arrays";
import { year1Production, offsetPct, type SolarAssumptions } from "../src/lib/solar-money";
import { blockPanelCount, parseLayoutBlocks, type LayoutBlock } from "../src/lib/solar-layout";
import { derateToLossesPct, yieldCacheKey } from "../src/lib/solar-pvwatts";
import { effectiveUsageKwh } from "../src/lib/solar-energy";
import { SOLAR_ASSUMPTION_DEFAULTS } from "../src/server/modules/solar/settings";

/**
 * A PLAIN client, not `@/server/db/client`.
 *
 * The extended one enforces the vertical scope from async-local storage, which
 * a script has none of — and the whole point here is to sweep every solar
 * design in the database rather than the ones one workspace can see.
 */
const prisma = new PrismaClient();

const apply = process.argv.includes("--apply");

/** "Jane Smith", or the id when the join came back empty. */
function leadLabel(
  lead: { firstName: string; lastName: string } | null | undefined,
  leadId: string
): string {
  if (!lead) return leadId;
  const name = `${lead.firstName} ${lead.lastName}`.trim();
  return name || leadId;
}

async function main() {
  const designs = await prisma.solarDesign.findMany({
    select: {
      leadId: true,
      companyId: true,
      layoutBlocks: true,
      moduleId: true,
      mountType: true,
      systemSizeKwDc: true,
      annualUsageKwh: true,
      usageAdjustmentKwh: true,
      year1ProductionKwh: true,
      offsetPct: true,
      lead: { select: { lat: true, lng: true, firstName: true, lastName: true } },
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`${designs.length} solar designs. ${apply ? "APPLYING" : "dry run — nothing will be written"}.\n`);
  if (designs.length === 0) return;

  // Settings and the panel are per COMPANY, and a sweep of every design would
  // otherwise ask for the same two rows once per deal.
  const settingsCache = new Map<string, SolarAssumptions>();
  const moduleCache = new Map<string, number | null>();

  const settingsFor = async (companyId: string): Promise<SolarAssumptions> => {
    const hit = settingsCache.get(companyId);
    if (hit) return hit;
    const row = await prisma.solarSettings.findUnique({ where: { companyId } });
    const view: SolarAssumptions = row
      ? {
          derateFactor: row.derateFactor,
          annualDegradationPct: row.annualDegradationPct,
          utilityEscalationPct: row.utilityEscalationPct,
          kwhPerKwYear: row.kwhPerKwYear,
          defaultGrossPpwCents: row.defaultGrossPpwCents,
          defaultDealerFeePct: row.defaultDealerFeePct,
          minOffsetPct: row.minOffsetPct,
          maxOffsetPct: row.maxOffsetPct,
          minPpwCents: row.minPpwCents,
          maxPpwCents: row.maxPpwCents,
        }
      : SOLAR_ASSUMPTION_DEFAULTS;
    settingsCache.set(companyId, view);
    return view;
  };

  /**
   * The wattage the design is priced on: the module it was quoted with, or the
   * catalogue's default when it has none — the same rule `resolveSizingModule`
   * applies, and never a guessed wattage.
   */
  const ratingFor = async (companyId: string, moduleId: string | null): Promise<number | null> => {
    const key = `${companyId}|${moduleId ?? ""}`;
    if (moduleCache.has(key)) return moduleCache.get(key) ?? null;
    const kept = moduleId
      ? await prisma.solarEquipment.findFirst({
          where: { companyId, id: moduleId, kind: "module" },
          select: { ratingW: true },
        })
      : null;
    const row =
      kept ??
      (await prisma.solarEquipment.findFirst({
        where: { companyId, kind: "module", isActive: true, isDefault: true },
        select: { ratingW: true },
      }));
    moduleCache.set(key, row?.ratingW ?? null);
    return row?.ratingW ?? null;
  };

  const cachedYields = await prisma.solarYieldCache.findMany({
    select: { key: true, kwhPerKwYear: true },
  });
  const yieldByKey = new Map(cachedYields.map((y) => [y.key, y.kwhPerKwYear]));
  console.log(`${yieldByKey.size} simulated planes in the yield cache.\n`);

  let changed = 0;
  let same = 0;
  let skipped = 0;
  let totalBefore = 0;
  let totalAfter = 0;

  for (const d of designs) {
    const assumptions = await settingsFor(d.companyId);
    const moduleRatingW = await ratingFor(d.companyId, d.moduleId);
    const blocks: LayoutBlock[] = parseLayoutBlocks(d.layoutBlocks);
    const drawn = blocks.some((b) => blockPanelCount(b) > 0);
    const arrayType = d.mountType === "ground" ? ("ground" as const) : ("roof" as const);
    const lat = d.lead?.lat ?? null;
    const lng = d.lead?.lng ?? null;

    /**
     * A design with nothing drawn on it still has a size — an older quote, or
     * one typed before the roof designer existed — and its production is the
     * whole-system formula. Recomputing that from `systemTotals` would return
     * zero and wipe a live figure.
     */
    const year1 = drawn
      ? systemTotals(blocks, {
          lat,
          moduleRatingW,
          assumptions,
          planeYield: ({ tiltDeg, azimuthDeg }) => {
            if (lat == null || lng == null || tiltDeg == null || azimuthDeg == null) return null;
            const key = yieldCacheKey({
              lat,
              lon: lng,
              tiltDeg,
              azimuthDeg,
              lossesPct: derateToLossesPct(assumptions.derateFactor),
              arrayType,
            });
            return yieldByKey.get(key) ?? null;
          },
        }).year1ProductionKwh
      : year1Production(d.systemSizeKwDc ?? 0, assumptions);

    // A design that recomputes to nothing is one this script cannot price —
    // an empty catalogue, or a layout it could not read. Leave the stored
    // figure alone and say so rather than zeroing a live deal.
    if (year1 <= 0 && (d.year1ProductionKwh ?? 0) > 0) {
      skipped++;
      console.log(
        `  SKIP  ${leadLabel(d.lead, d.leadId)} — recomputes to 0, keeping ${d.year1ProductionKwh} kWh`
      );
      continue;
    }

    const usageKwh = effectiveUsageKwh(d.annualUsageKwh, d.usageAdjustmentKwh);
    const newOffset = usageKwh ? offsetPct(year1, usageKwh) : 0;

    totalBefore += d.year1ProductionKwh ?? 0;
    totalAfter += year1;

    if (year1 === d.year1ProductionKwh) {
      same++;
      continue;
    }

    changed++;
    const before = d.year1ProductionKwh ?? 0;
    const delta = before > 0 ? ((year1 - before) / before) * 100 : 0;
    console.log(
      `  ${apply ? "WRITE" : "would"}  ${leadLabel(d.lead, d.leadId)}: ` +
        `${before} → ${year1} kWh (${delta >= 0 ? "+" : ""}${delta.toFixed(1)}%), ` +
        `offset ${(d.offsetPct ?? 0).toFixed(0)}% → ${newOffset.toFixed(0)}%`
    );

    if (apply) {
      await prisma.solarDesign.update({
        where: { leadId: d.leadId },
        data: { year1ProductionKwh: year1, offsetPct: newOffset },
      });
    }
  }

  const totalDelta = totalBefore > 0 ? ((totalAfter - totalBefore) / totalBefore) * 100 : 0;
  console.log(
    `\n${changed} ${apply ? "updated" : "to update"}, ${same} already correct, ${skipped} skipped.`
  );
  console.log(
    `Across every design priced: ${totalBefore.toLocaleString()} → ${totalAfter.toLocaleString()} kWh ` +
      `(${totalDelta >= 0 ? "+" : ""}${totalDelta.toFixed(1)}%).`
  );
  if (!apply && changed > 0) console.log("\nRe-run with --apply to write these.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
