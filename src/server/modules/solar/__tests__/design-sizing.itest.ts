import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { resolveSizingModule } from "@/server/modules/solar/sizing";

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
