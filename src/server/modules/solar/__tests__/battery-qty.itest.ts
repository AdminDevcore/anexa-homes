import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * How many batteries a design starts with.
 *
 * The count on a design has always defaulted to zero, and every reader
 * downstream turned "a battery, no count" into ONE — including the battery
 * programme, which multiplies its money per unit. For a company whose standard
 * offer is two, that quoted the second battery for free and earned on one of
 * them, silently, unless a rep found the small quantity box that only appears
 * beside the picker AFTER a battery is chosen.
 *
 * So the company states the number once, in Settings → Solar, and picking a
 * battery writes it. The three cases that matter are all here: it lands on an
 * empty slot, it does NOT overwrite a rep who already decided, and clearing the
 * battery takes the count with it so the next pick starts clean again.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setSolarDesignEquipmentAction } = await import("../equipment-actions");

// Unextended on purpose: this client builds fixtures. The code under test is
// what has to survive the vertical extension — hence runInVertical below.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let batteryA: string;
let batteryB: string;

const pick = (input: { batteryId?: string | null; batteryQty?: number }) =>
  runInVertical("solar", () => setSolarDesignEquipmentAction({ leadId, ...input }));

const design = () => db.solarDesign.findUnique({ where: { leadId } });

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Battery Co", slug: `bq-${process.pid}-${Date.now()}` },
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
      firstName: "Bat",
      lastName: "Test",
    },
  });
  leadId = lead.id;

  const make = (model: string) =>
    db.solarEquipment.create({ data: { companyId, kind: "battery", model, ratingW: 13500 } });
  batteryA = (await make(`A-${process.pid}`)).id;
  batteryB = (await make(`B-${process.pid}`)).id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarSettings.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("a battery arrives at the company's standard quantity", () => {
  it("writes the company default onto a design that had no battery", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });

    const res = await pick({ batteryId: batteryA });

    expect(res.ok).toBe(true);
    expect(res.ok && res.batteryQty).toBe(2);
    expect((await design())?.batteryQty).toBe(2);
  });

  it("uses two for a company that has never opened the settings page", async () => {
    // No solarSettings row at all — the fallback has to match the column
    // default, because an untouched company and an absent one are one company.
    const res = await pick({ batteryId: batteryA });

    expect(res.ok && res.batteryQty).toBe(2);
    expect((await design())?.batteryQty).toBe(2);
  });

  it("honours a company that sells one", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 1 } });

    await pick({ batteryId: batteryA });

    expect((await design())?.batteryQty).toBe(1);
  });

  it("never overwrites a count the rep set, even when the battery is swapped", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });
    await pick({ batteryId: batteryA });
    await pick({ batteryQty: 3 });

    const res = await pick({ batteryId: batteryB });

    expect(res.ok && res.batteryQty).toBe(3);
    const d = await design();
    expect(d?.batteryId).toBe(batteryB);
    expect(d?.batteryQty).toBe(3);
  });

  it("an explicit count in the same call wins over the default", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });

    await pick({ batteryId: batteryA, batteryQty: 4 });

    expect((await design())?.batteryQty).toBe(4);
  });

  it("clearing the battery clears the count, and the next pick starts at the default", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });
    await pick({ batteryId: batteryA, batteryQty: 5 });

    await pick({ batteryId: null });
    expect((await design())?.batteryQty).toBe(0);

    await pick({ batteryId: batteryA });
    expect((await design())?.batteryQty).toBe(2);
  });
});
