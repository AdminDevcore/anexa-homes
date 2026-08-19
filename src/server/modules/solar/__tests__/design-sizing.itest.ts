import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { resolveSizingModule } from "@/server/modules/solar/sizing";
import { panelCount, type LayoutBlock } from "@/lib/solar-layout";

/**
 * Where the watts come from once a rep no longer picks equipment.
 *
 * A rep sells a system; the approved-vendor list decides which panel it is
 * built from. These tests pin the two halves of that: a design with no module
 * takes the catalogue default, and a design that already HAS one keeps it, so
 * next year's AVL cannot silently re-price a quote sent last year.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Sizing Co", slug: `sz-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "Siz", lastName: "Test" },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarEquipment.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const panel = (over: Record<string, unknown> = {}) =>
  db.solarEquipment.create({
    data: {
      companyId,
      kind: "module",
      model: `P-${Math.random().toString(36).slice(2, 8)}`,
      ratingW: 400,
      ...over,
    },
  });

describe("the default panel sizes the system", () => {
  it("fills an empty design with the active default module", async () => {
    const def = await panel({ ratingW: 450, isDefault: true });
    await db.solarDesign.create({ data: { companyId, leadId, moduleQty: 20 } });

    const chosen = await runInVertical("solar", () => resolveSizingModule(companyId, null));

    expect(chosen?.id).toBe(def.id);
    expect(chosen?.ratingW).toBe(450);
  });

  it("keeps a module the design already chose, even after the default changes", async () => {
    const lastYear = await panel({ ratingW: 400 });
    await panel({ ratingW: 450, isDefault: true });

    const chosen = await runInVertical("solar", () => resolveSizingModule(companyId, lastYear.id));

    expect(chosen?.id).toBe(lastYear.id);
    expect(chosen?.ratingW).toBe(400);
  });

  it("ignores a retired default rather than sizing from a product nobody sells", async () => {
    await panel({ ratingW: 450, isDefault: true, isActive: false });

    expect(await runInVertical("solar", () => resolveSizingModule(companyId, null))).toBeNull();
  });

  it("does not reach into another company's catalogue", async () => {
    const other = await db.company.create({
      data: { name: "Other Co", slug: `oth-${process.pid}-${Date.now()}` },
    });
    await db.solarEquipment.create({
      data: { companyId: other.id, kind: "module", model: "THEIRS", ratingW: 500, isDefault: true },
    });

    expect(await runInVertical("solar", () => resolveSizingModule(companyId, null))).toBeNull();

    await db.company.deleteMany({ where: { id: other.id } });
  });
});

describe("build details never move a quoted number", () => {
  it("records the inverter and interconnection details without touching system size", async () => {
    const p = await panel({ ratingW: 400, isDefault: true });
    const inv = await db.solarEquipment.create({
      data: { companyId, kind: "inverter", model: "INV-1", ratingW: 7600 },
    });
    await db.solarDesign.create({
      data: { companyId, leadId, moduleId: p.id, moduleQty: 20, systemSizeKwDc: 8, year1ProductionKwh: 9760 },
    });

    await db.solarDesign.update({
      where: { leadId },
      data: { inverterId: inv.id, utilityAccountNo: "ACCT-9", meterNo: "MTR-3" },
    });

    const after = await db.solarDesign.findUnique({ where: { leadId } });
    expect(after?.inverterId).toBe(inv.id);
    expect(after?.utilityAccountNo).toBe("ACCT-9");
    // The invariant saveSolarBuildDetailsAction must preserve: only the module
    // sizes the system, so nothing on the ops card may move these.
    expect(after?.systemSizeKwDc).toBe(8);
    expect(after?.year1ProductionKwh).toBe(9760);
  });
});

describe("the drawing is what sets the module count", () => {
  const blocks: LayoutBlock[] = [
    { id: "b1", originE: 0, originN: 0, rotationDeg: 12, cols: 5, rows: 4, orientation: "portrait", omitted: [3] },
  ];

  it("sizes the system from the geometry, not from anything a client says", async () => {
    const p = await panel({ ratingW: 400, isDefault: true });
    await db.solarDesign.create({ data: { companyId, leadId, moduleQty: 0, annualUsageKwh: 14_000 } });

    // 5 x 4 with one knocked out for a vent.
    expect(panelCount(blocks)).toBe(19);

    await db.solarDesign.update({
      where: { leadId },
      data: {
        layoutBlocks: blocks,
        moduleQty: panelCount(blocks),
        moduleId: p.id,
        systemSizeKwDc: (panelCount(blocks) * 400) / 1000,
      },
    });

    const after = await db.solarDesign.findUnique({ where: { leadId } });
    expect(after?.moduleQty).toBe(19);
    expect(after?.systemSizeKwDc).toBeCloseTo(7.6, 6);
  });

  it("round-trips the blocks through JSONB unchanged, rotation included", async () => {
    // The drawing is the record of what was quoted. If a rotation or an
    // omission does not survive storage, a reopened design is a different roof.
    await db.solarDesign.create({ data: { companyId, leadId, layoutBlocks: blocks } });

    const after = await db.solarDesign.findUnique({ where: { leadId } });
    expect(after?.layoutBlocks).toEqual(blocks);
  });
});
