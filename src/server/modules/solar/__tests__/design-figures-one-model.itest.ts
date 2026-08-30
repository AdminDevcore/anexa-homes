import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { yieldCacheKey } from "@/lib/solar-pvwatts";
import { planeFor } from "@/server/modules/solar/pvwatts";
import type { LayoutBlock } from "@/lib/solar-layout";

/**
 * ONE production model, whichever screen writes the design.
 *
 * A rep drew 24 panels on a south roof PVWatts has already simulated. The
 * designer said 14,977 kWh and 118% offset; the rep went back to the System
 * design step, pressed Save, and the deal read 12,219 kWh and 96% — because
 * that step recomputed production from the company's flat market average and
 * overwrote the figure the roof had earned. Nobody touched the roof between
 * the two numbers, and the second one is what the proposal freezes.
 *
 * So: every action that writes the design's figures has to derive them the same
 * way — from the arrays actually drawn, on the yields actually simulated.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveSolarDesignAction } = await import("../actions");
const { recomputeDesignFigures } = await import("../recompute");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

/** Plano, TX — the same roof the bug was found on. */
const LAT = 33.0048;
const LNG = -96.7178;
/** What NREL says a 26.6° south plane makes here, per kW-DC, per year. */
const MEASURED = 1492.9;

let companyId: string;
let leadId: string;

/** 24 panels on one south-facing plane: 12 across, 2 up, nothing knocked out. */
const ARRAY: LayoutBlock = {
  id: "a1",
  originE: 0,
  originN: 0,
  rotationDeg: 0,
  cols: 12,
  rows: 2,
  orientation: "portrait",
  omitted: [],
  azimuthDeg: 180,
  tiltDeg: 26.6,
};

const design = () => db.solarDesign.findUnique({ where: { leadId } });

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "One Model Co", slug: `om-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  session.requireUser.mockResolvedValue({
    userId: "u-1",
    companyId,
    role: "super_admin",
    permissions: {},
  });

  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id,
      firstName: "One", lastName: "Model", lat: LAT, lng: LNG,
    },
  });
  leadId = lead.id;

  await db.solarEquipment.create({
    data: {
      companyId, kind: "module", model: `M-${process.pid}`,
      ratingW: 440, widthMm: 1134, heightMm: 1762, isDefault: true,
    },
  });
});

beforeEach(async () => {
  // The plane is already in the cache, so nothing here reaches the network —
  // and a stub makes that a failure rather than a slow test if it ever does.
  vi.spyOn(globalThis, "fetch").mockRejectedValue(new Error("no network in this test"));

  await db.solarYieldCache.deleteMany({});
  await db.solarYieldCache.create({
    data: {
      key: yieldCacheKey(
        planeFor({
          lat: LAT, lon: LNG, tiltDeg: ARRAY.tiltDeg, azimuthDeg: ARRAY.azimuthDeg,
          derateFactor: 0.84, arrayType: "roof",
        })!
      ),
      lat: 33, lon: -96.7, tiltDeg: 26.6, azimuthDeg: 180, lossesPct: 16,
      arrayType: "roof", kwhPerKwYear: MEASURED, monthly: [], station: "704118",
    },
  });

  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarDesign.create({
    data: {
      companyId, leadId, mountType: "roof",
      annualUsageKwh: 12_667,
      layoutBlocks: [ARRAY] as never,
    },
  });
});

afterAll(async () => {
  vi.restoreAllMocks();
  await db.solarYieldCache.deleteMany({});
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

/** 10.56 kW on a simulated plane, quoted 5% under the model. */
const EXPECTED = Math.round(10.56 * MEASURED * 0.95);

describe("the figures a saved design carries", () => {
  it("prices the drawn arrays on the yields NREL simulated", async () => {
    const figures = await runInVertical("solar", () =>
      recomputeDesignFigures(companyId, leadId)
    );

    expect(figures?.systemSizeKwDc).toBe(10.56);
    expect(figures?.measuredArrays).toBe(1);
    expect(figures?.year1ProductionKwh).toBe(EXPECTED);
  });

  /**
   * The bug. Saving the mount type is not a repricing event, and the step that
   * does it holds no opinion about what the roof makes.
   */
  it("does not lose them when the System design step is saved", async () => {
    await runInVertical("solar", () => recomputeDesignFigures(companyId, leadId));
    const before = await design();

    const res = await runInVertical("solar", () =>
      saveSolarDesignAction({ leadId, mountType: "roof" })
    );
    expect(res.ok).toBe(true);

    const after = await design();
    expect(after?.year1ProductionKwh).toBe(before!.year1ProductionKwh);
    expect(after?.offsetPct).toBeCloseTo(before!.offsetPct!, 6);
    // And specifically NOT the flat market average, which is the figure that
    // appeared on the deal: 10.56 × 1450 × 0.84 × 0.95.
    expect(after?.year1ProductionKwh).not.toBe(12_219);
  });

  /** The panel count, the size and the yield source have to survive it too. */
  it("keeps the array's own model on the row", async () => {
    await runInVertical("solar", () => recomputeDesignFigures(companyId, leadId));
    await runInVertical("solar", () => saveSolarDesignAction({ leadId, mountType: "roof" }));

    const after = await design();
    expect(after?.moduleQty).toBe(24);
    expect(after?.systemSizeKwDc).toBe(10.56);
    expect(after?.yieldSource).toBe("pvwatts");
    expect(after?.yieldArrays).toBe(1);
  });

  /**
   * Switching to a ground mount IS a repricing event — an open rack runs cooler
   * than a roof and PVWatts knows it — so the figures move, on the same model.
   */
  it("reprices on the same model when the mount type changes", async () => {
    await runInVertical("solar", () => recomputeDesignFigures(companyId, leadId));

    await db.solarYieldCache.create({
      data: {
        key: yieldCacheKey(
          planeFor({
            lat: LAT, lon: LNG, tiltDeg: ARRAY.tiltDeg, azimuthDeg: ARRAY.azimuthDeg,
            derateFactor: 0.84, arrayType: "ground",
          })!
        ),
        lat: 33, lon: -96.7, tiltDeg: 26.6, azimuthDeg: 180, lossesPct: 16,
        arrayType: "ground", kwhPerKwYear: 1560.2, monthly: [], station: "704118",
      },
    });

    await runInVertical("solar", () => saveSolarDesignAction({ leadId, mountType: "ground" }));

    const after = await design();
    expect(after?.mountType).toBe("ground");
    expect(after?.year1ProductionKwh).toBe(Math.round(10.56 * 1560.2 * 0.95));
  });
});
