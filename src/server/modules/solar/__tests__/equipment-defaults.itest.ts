import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * Choosing the catalogue's standard equipment, and what that choice reaches.
 *
 * Two halves, and the second is the one that was missing for a year. Setting a
 * default worked — it was one line in an overflow menu, but it wrote the
 * column. What it DID afterwards was the problem: the module star sized a
 * design, the inverter star reached nothing until it blocked a lender
 * application, and the battery star sorted a dropdown.
 *
 * So these pin both: the panel writes one default per kind and demotes the
 * incumbent in the same breath, and the battery — the last decorative one —
 * actually lands on a deal the moment a rep says the deal has storage on it.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setSolarEquipmentDefaultsAction, setSolarSystemTypeAction } = await import("../actions");

// Unextended on purpose: this client builds fixtures. The code under test is
// what has to survive the vertical extension — hence runInVertical below.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

const setDefaults = (input: Parameters<typeof setSolarEquipmentDefaultsAction>[0]) =>
  runInVertical("solar", () => setSolarEquipmentDefaultsAction(input));

const quote = (systemType: "pv" | "pv_storage" | "storage") =>
  runInVertical("solar", () => setSolarSystemTypeAction({ leadId, systemType }));

const design = () => db.solarDesign.findUnique({ where: { leadId } });

const item = (kind: "module" | "inverter" | "battery", over: Record<string, unknown> = {}) =>
  db.solarEquipment.create({
    data: {
      companyId,
      kind,
      model: `${kind[0].toUpperCase()}-${Math.random().toString(36).slice(2, 8)}`,
      ratingW: kind === "battery" ? 13500 : 440,
      ...over,
    },
  });

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Defaults Co", slug: `df-${process.pid}-${Date.now()}` },
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
      companyId,
      vertical: "solar",
      pipelineId: pipe.id,
      stageId: stage.id,
      firstName: "Def",
      lastName: "Test",
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarEquipment.deleteMany({ where: { companyId } });
  await db.solarSettings.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const starred = (kind: "module" | "inverter" | "battery") =>
  db.solarEquipment.findFirst({ where: { companyId, kind, isDefault: true }, select: { id: true } });

describe("setting the catalogue's standard equipment", () => {
  it("stars one of each kind in a single call", async () => {
    const [m, i, b] = await Promise.all([item("module"), item("inverter"), item("battery")]);

    const res = await setDefaults({
      moduleId: m.id,
      inverterId: i.id,
      batteryId: b.id,
      defaultBatteryQty: 3,
    });

    expect(res.ok).toBe(true);
    expect((await starred("module"))?.id).toBe(m.id);
    expect((await starred("inverter"))?.id).toBe(i.id);
    expect((await starred("battery"))?.id).toBe(b.id);
    const settings = await db.solarSettings.findUnique({ where: { companyId } });
    expect(settings?.defaultBatteryQty).toBe(3);
  });

  it("demotes the incumbent, so a kind never has two", async () => {
    const lastYear = await item("module", { isDefault: true });
    const thisYear = await item("module");

    await setDefaults({ moduleId: thisYear.id });

    const all = await db.solarEquipment.findMany({
      where: { companyId, kind: "module", isDefault: true },
    });
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(thisYear.id);
    expect((await db.solarEquipment.findUnique({ where: { id: lastYear.id } }))?.isDefault).toBe(
      false
    );
  });

  it("clears a kind when it is set to nothing", async () => {
    const m = await item("module", { isDefault: true });

    await setDefaults({ moduleId: null });

    expect(await starred("module")).toBeNull();
    expect((await db.solarEquipment.findUnique({ where: { id: m.id } }))?.isDefault).toBe(false);
  });

  it("leaves a kind alone when the call says nothing about it", async () => {
    const m = await item("module", { isDefault: true });
    const i = await item("inverter");

    await setDefaults({ inverterId: i.id });

    expect((await starred("module"))?.id).toBe(m.id);
  });

  it("refuses a retired product rather than starring one nobody can pick", async () => {
    const retired = await item("battery", { isActive: false });

    const res = await setDefaults({ batteryId: retired.id });

    expect(res.ok).toBe(false);
    expect(await starred("battery")).toBeNull();
  });

  it("refuses an id from another company's catalogue", async () => {
    const other = await db.company.create({
      data: { name: "Other Def Co", slug: `odf-${process.pid}-${Date.now()}` },
    });
    const theirs = await db.solarEquipment.create({
      data: { companyId: other.id, kind: "module", model: "THEIRS", ratingW: 500 },
    });

    const res = await setDefaults({ moduleId: theirs.id });

    expect(res.ok).toBe(false);
    expect(
      (await db.solarEquipment.findUnique({ where: { id: theirs.id } }))?.isDefault
    ).toBe(false);

    await db.company.deleteMany({ where: { id: other.id } });
  });

  it("refuses an id of the wrong kind — a battery cannot be the default module", async () => {
    const b = await item("battery");

    const res = await setDefaults({ moduleId: b.id });

    expect(res.ok).toBe(false);
  });
});

describe("the standard battery reaches the deal", () => {
  it("lands when a rep says the deal has storage on it", async () => {
    const b = await item("battery", { isDefault: true });
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });
    await db.solarDesign.create({ data: { companyId, leadId, systemType: "pv" } });

    const res = await quote("pv_storage");

    expect(res.ok).toBe(true);
    const d = await design();
    expect(d?.batteryId).toBe(b.id);
    expect(d?.batteryQty).toBe(2);
  });

  it("comes off again when the deal goes back to panels only", async () => {
    const b = await item("battery", { isDefault: true });
    await db.solarDesign.create({
      data: { companyId, leadId, systemType: "pv_storage", batteryId: b.id, batteryQty: 2 },
    });

    await quote("pv");

    const d = await design();
    expect(d?.batteryId).toBeNull();
    expect(d?.batteryQty).toBe(0);
  });

  it("never overwrites the battery a rep chose themselves", async () => {
    const theirs = await item("battery");
    await item("battery", { isDefault: true });
    await db.solarDesign.create({
      data: { companyId, leadId, systemType: "pv", batteryId: theirs.id, batteryQty: 1 },
    });

    await quote("storage");

    const d = await design();
    expect(d?.batteryId).toBe(theirs.id);
    expect(d?.batteryQty).toBe(1);
  });

  it("puts no battery on a deal when the catalogue has starred none", async () => {
    await item("battery");
    await db.solarDesign.create({ data: { companyId, leadId, systemType: "pv" } });

    await quote("pv_storage");

    expect((await design())?.batteryId).toBeNull();
  });

  it("still clears the array on a storage-only deal", async () => {
    await item("battery", { isDefault: true });
    await db.solarDesign.create({
      data: {
        companyId,
        leadId,
        systemType: "pv_storage",
        systemSizeKwDc: 10,
        year1ProductionKwh: 14000,
        moduleQty: 24,
      },
    });

    await quote("storage");

    const d = await design();
    expect(d?.systemSizeKwDc).toBe(0);
    expect(d?.moduleQty).toBe(0);
    expect(d?.batteryId).not.toBeNull();
  });
});
