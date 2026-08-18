import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Retiring versus deleting a catalogue item.
 *
 * The approved-vendor list turns over every year, so last year's products have
 * to stop being sellable WITHOUT rewriting last year's deals. Deleting cannot
 * do that: the design foreign keys are ON DELETE SET NULL, so a delete does not
 * fail loudly — it silently blanks the equipment on every deal that used it,
 * and those deals can no longer explain their own system size.
 *
 * These tests pin the difference, against a real database, because the whole
 * risk lives in the foreign-key behaviour rather than in any type.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({ data: { name: "Equip Lifecycle Co", slug: `eq-${process.pid}-${Date.now()}` } });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({ data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 } });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "Eq", lastName: "Test" },
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

const mod = (over: Record<string, unknown> = {}) =>
  db.solarEquipment.create({
    data: { companyId, kind: "module", manufacturer: "ZZ", model: `M-${Math.random().toString(36).slice(2, 8)}`, ratingW: 400, ...over },
  });

describe("an AVL year labels the list a product belongs to", () => {
  it("stores the year, and allows none", async () => {
    const a = await mod({ avlYear: 2026 });
    const b = await mod({ avlYear: null });
    expect((await db.solarEquipment.findUniqueOrThrow({ where: { id: a.id } })).avlYear).toBe(2026);
    expect((await db.solarEquipment.findUniqueOrThrow({ where: { id: b.id } })).avlYear).toBeNull();
  });

  it("the same product can exist for two different years side by side", async () => {
    // Identity is (kind, manufacturer, model, rating) — the year is a label, so
    // carrying one product across two lists needs distinct model text. This
    // documents that: the year alone does not make a duplicate unique.
    await mod({ model: "Panel-X 2025", avlYear: 2025 });
    await mod({ model: "Panel-X 2026", avlYear: 2026 });
    const rows = await db.solarEquipment.findMany({ where: { companyId }, orderBy: { avlYear: "asc" } });
    expect(rows.map((r) => r.avlYear)).toEqual([2025, 2026]);
  });
});

describe("retiring keeps history intact", () => {
  it("a retired item still resolves for the design that already uses it", async () => {
    const m = await mod();
    await db.solarDesign.create({ data: { companyId, leadId, moduleId: m.id, moduleQty: 20, systemSizeKwDc: 8 } });

    await db.solarEquipment.update({ where: { id: m.id }, data: { isActive: false, isDefault: false } });

    const design = await db.solarDesign.findUniqueOrThrow({
      where: { leadId },
      include: { module: { select: { model: true, ratingW: true } } },
    });
    expect(design.moduleId).toBe(m.id);
    expect(design.module?.ratingW).toBe(400);
    expect(design.systemSizeKwDc).toBe(8);
  });

  it("a retired item is excluded from what a rep can pick", async () => {
    const live = await mod();
    const dead = await mod();
    await db.solarEquipment.update({ where: { id: dead.id }, data: { isActive: false } });
    const pickable = await db.solarEquipment.findMany({ where: { companyId, kind: "module", isActive: true } });
    expect(pickable.map((p) => p.id)).toEqual([live.id]);
  });

  it("retiring is reversible", async () => {
    const m = await mod();
    await db.solarEquipment.update({ where: { id: m.id }, data: { isActive: false } });
    await db.solarEquipment.update({ where: { id: m.id }, data: { isActive: true } });
    expect((await db.solarEquipment.findUniqueOrThrow({ where: { id: m.id } })).isActive).toBe(true);
  });
});

describe("a retired item a design still uses stays selectable ON THAT DESIGN", () => {
  it("the builder query returns it, so the dropdown cannot silently blank the deal", async () => {
    // Filtering to isActive alone looks right and quietly destroys data: the
    // retired module drops out of the dropdown, the select falls back to
    // "none", and the next save writes moduleId: null onto a deal that had a
    // perfectly good module. This is the query the builder page actually runs.
    const used = await mod();
    const other = await mod();
    await db.solarDesign.create({ data: { companyId, leadId, moduleId: used.id, moduleQty: 20 } });
    await db.solarEquipment.update({ where: { id: used.id }, data: { isActive: false } });

    const design = await db.solarDesign.findUniqueOrThrow({ where: { leadId } });
    const offered = await db.solarEquipment.findMany({
      where: {
        companyId,
        OR: [
          { isActive: true },
          { id: { in: [design.moduleId, design.inverterId, design.batteryId].filter((x): x is string => !!x) } },
        ],
      },
      select: { id: true, isActive: true },
    });
    const ids = offered.map((o) => o.id);
    expect(ids).toContain(used.id);   // retired, but this design uses it
    expect(ids).toContain(other.id);  // still sellable
    expect(offered.find((o) => o.id === used.id)!.isActive).toBe(false);
  });

  it("a design that uses nothing is offered only sellable items", async () => {
    const live = await mod();
    const dead = await mod();
    await db.solarEquipment.update({ where: { id: dead.id }, data: { isActive: false } });
    const offered = await db.solarEquipment.findMany({
      where: { companyId, OR: [{ isActive: true }, { id: { in: [] } }] },
      select: { id: true },
    });
    expect(offered.map((o) => o.id)).toEqual([live.id]);
  });
});

describe("deleting an in-use item is the thing that destroys history", () => {
  it("DEMONSTRATES the damage: the FK blanks the design rather than erroring", async () => {
    // This is why the action refuses. Nothing throws — the deal just loses its
    // equipment, and its system size stops reconciling with anything.
    const m = await mod();
    await db.solarDesign.create({ data: { companyId, leadId, moduleId: m.id, moduleQty: 20, systemSizeKwDc: 8 } });

    await db.solarEquipment.delete({ where: { id: m.id } });

    const after = await db.solarDesign.findUniqueOrThrow({ where: { leadId } });
    expect(after.moduleId).toBeNull();      // silently blanked
    expect(after.systemSizeKwDc).toBe(8);   // size now explains nothing
  });

  it("usage is detectable across all three slots, which is what the guard counts", async () => {
    const m = await mod();
    const inv = await mod({ kind: "inverter" });
    const bat = await mod({ kind: "battery" });
    await db.solarDesign.create({
      data: { companyId, leadId, moduleId: m.id, inverterId: inv.id, batteryId: bat.id, moduleQty: 20 },
    });
    for (const [id, field] of [[m.id, "moduleId"], [inv.id, "inverterId"], [bat.id, "batteryId"]] as const) {
      const n = await db.solarDesign.count({ where: { companyId, [field]: id } });
      expect(n).toBe(1);
    }
  });

  it("an unused item has zero usage, so deleting it is safe", async () => {
    const m = await mod();
    const used =
      (await db.solarDesign.count({ where: { companyId, moduleId: m.id } })) +
      (await db.solarDesign.count({ where: { companyId, inverterId: m.id } })) +
      (await db.solarDesign.count({ where: { companyId, batteryId: m.id } }));
    expect(used).toBe(0);
    await db.solarEquipment.delete({ where: { id: m.id } });
    expect(await db.solarEquipment.findUnique({ where: { id: m.id } })).toBeNull();
  });
});

describe("lender approved-vendor lists decide what a rep may pick", () => {
  /** The exact query the builder runs for one component. */
  const offeredFor = async (kind: "module" | "inverter" | "battery", lenderId: string | null, chosen: string[] = []) => {
    const rows = await db.solarEquipment.findMany({
      where: {
        companyId,
        kind,
        OR: [{ isActive: true }, { id: { in: chosen } }],
      },
      select: { id: true, model: true, isActive: true, lenderApprovals: { select: { lenderId: true } } },
    });
    const pick = new Set(chosen);
    return rows.filter(
      (e) => !lenderId || e.lenderApprovals.some((a) => a.lenderId === lenderId) || pick.has(e.id)
    );
  };

  let creditHuman: string, goodLeap: string;

  beforeEach(async () => {
    await db.solarLender.deleteMany({ where: { companyId } });
    creditHuman = (await db.solarLender.create({ data: { companyId, name: "Credit Human" } })).id;
    goodLeap = (await db.solarLender.create({ data: { companyId, name: "GoodLeap" } })).id;
  });

  it("an item approved by two lenders shows for BOTH", async () => {
    // The case that motivated this: most equipment is on more than one AVL, and
    // being on someone else's list must not stop it showing for yours.
    const both = await mod({ model: "OnTwoLists" });
    await db.solarEquipmentLender.createMany({
      data: [{ equipmentId: both.id, lenderId: creditHuman }, { equipmentId: both.id, lenderId: goodLeap }],
    });
    expect((await offeredFor("module", creditHuman)).map((e) => e.id)).toContain(both.id);
    expect((await offeredFor("module", goodLeap)).map((e) => e.id)).toContain(both.id);
  });

  it("an item approved by one lender is hidden from the other", async () => {
    const only = await mod({ model: "GoodLeapOnly" });
    await db.solarEquipmentLender.create({ data: { equipmentId: only.id, lenderId: goodLeap } });
    expect((await offeredFor("module", goodLeap)).map((e) => e.id)).toContain(only.id);
    expect((await offeredFor("module", creditHuman)).map((e) => e.id)).not.toContain(only.id);
  });

  it("STRICT: an untagged item is hidden as soon as any lender is selected", async () => {
    // The deliberate choice. An item nobody has tagged cannot be quoted into a
    // submission that would bounce; the builder says how many are hidden so the
    // short list is explained rather than mysterious.
    const untagged = await mod({ model: "NeverTagged" });
    expect((await offeredFor("module", null)).map((e) => e.id)).toContain(untagged.id);
    expect((await offeredFor("module", creditHuman)).map((e) => e.id)).not.toContain(untagged.id);
  });

  it("no lender selected means no filtering at all", async () => {
    const a = await mod();
    const b = await mod();
    await db.solarEquipmentLender.create({ data: { equipmentId: a.id, lenderId: goodLeap } });
    const ids = (await offeredFor("module", null)).map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
  });

  it("an item this design already uses survives a lender switch", async () => {
    // Otherwise choosing a lender silently blanks equipment the deal already
    // had — the same failure mode as retiring, and the same fix.
    const chosen = await mod({ model: "AlreadyOnTheDeal" });
    await db.solarEquipmentLender.create({ data: { equipmentId: chosen.id, lenderId: goodLeap } });
    const offered = await offeredFor("module", creditHuman, [chosen.id]);
    expect(offered.map((e) => e.id)).toContain(chosen.id);
  });

  it("lender names are unique per company, case-insensitively", async () => {
    // Two "Credit Human" rows would split one AVL in half and hide approved
    // equipment from whoever picked the wrong one.
    await expect(db.solarLender.create({ data: { companyId, name: "credit human" } })).rejects.toThrow();
  });

  it("deleting a lender clears its approvals but never touches the equipment", async () => {
    const m = await mod();
    await db.solarEquipmentLender.create({ data: { equipmentId: m.id, lenderId: goodLeap } });
    await db.solarLender.delete({ where: { id: goodLeap } });
    expect(await db.solarEquipmentLender.count({ where: { equipmentId: m.id } })).toBe(0);
    expect(await db.solarEquipment.findUnique({ where: { id: m.id } })).not.toBeNull();
  });

  it("deleting a lender a design is built for would blank that design's lender", async () => {
    // Which is why the action refuses while any design references it.
    const m = await mod();
    await db.solarDesign.create({ data: { companyId, leadId, moduleId: m.id, lenderId: creditHuman } });
    expect(await db.solarDesign.count({ where: { companyId, lenderId: creditHuman } })).toBe(1);
    await db.solarLender.delete({ where: { id: creditHuman } });
    expect((await db.solarDesign.findUniqueOrThrow({ where: { leadId } })).lenderId).toBeNull();
  });
});
