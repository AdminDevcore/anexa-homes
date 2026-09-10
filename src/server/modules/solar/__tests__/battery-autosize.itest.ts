import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * Sizing the battery count to the home instead of quoting a flat number.
 *
 * The company's `defaultBatteryQty` is an answer to the wrong question: two is
 * right for the house it was chosen for and wrong for the one next door,
 * because what a battery has to do is carry the night — and the night belongs
 * to the home, not to the price list. With `autoBatteryQty` on, the count is
 * derived from the year's kilowatt-hours, the company's night share, and the
 * capacity of the battery actually being quoted.
 *
 * The cases that matter are the ones where the rule has to STAND DOWN. A
 * derived number that overwrites a person's decision is not a convenience, it
 * is a deal quoting something nobody agreed to — so a typed count latches, and
 * the latch is only released by a change that makes the old count meaningless.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setSolarDesignEquipmentAction } = await import("../equipment-actions");
const { resolveAutoBatteryQty, resolveDesignBattery } = await import("../sizing");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
/** 13.5 kWh — a Powerwall. */
let powerwall: string;
/** 10 kWh, so the same night needs a different number of them. */
let small: string;
/** 40 kWh, big enough to carry a night on its own. */
let big: string;

const pick = (input: { batteryId?: string | null; batteryQty?: number; batteryQtyAuto?: boolean }) =>
  runInVertical("solar", () => setSolarDesignEquipmentAction({ leadId, ...input }));

const design = () => db.solarDesign.findUnique({ where: { leadId } });

/** Turn sizing on, at a night share. */
const sizeToTheHome = (batteryNightSharePct = 55) =>
  db.solarSettings.create({
    data: { companyId, defaultBatteryQty: 2, autoBatteryQty: true, batteryNightSharePct },
  });

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Autosize Co", slug: `abq-${process.pid}-${Date.now()}` },
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
      firstName: "Night",
      lastName: "Load",
    },
  });
  leadId = lead.id;

  const make = (model: string, ratingW: number, isDefault = false) =>
    db.solarEquipment.create({ data: { companyId, kind: "battery", model, ratingW, isDefault } });
  powerwall = (await make(`PW-${process.pid}`, 13_500, true)).id;
  small = (await make(`SM-${process.pid}`, 10_000)).id;
  big = (await make(`BIG-${process.pid}`, 40_000)).id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarSettings.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

/** A design with figures on it, straight to the database. */
async function seedDesign(data: Record<string, unknown>) {
  return db.solarDesign.create({
    data: { companyId, leadId, systemType: "pv_storage", batteryId: powerwall, ...data },
  });
}

const sizedFor = (d: {
  systemType: "pv" | "pv_storage" | "storage";
  batteryId: string | null;
  batteryQtySetByRep?: boolean;
  year1ProductionKwh?: number;
  annualUsageKwh?: number | null;
  usageAdjustmentKwh?: number;
}) =>
  runInVertical("solar", () =>
    resolveAutoBatteryQty(companyId, {
      year1ProductionKwh: 0,
      annualUsageKwh: null,
      usageAdjustmentKwh: 0,
      ...d,
    })
  );

describe("the count follows the home's night", () => {
  it("sizes a solar + storage deal off what the array makes", async () => {
    await sizeToTheHome(55);

    // 20,000 ÷ 365 × 55% = 30.14 kWh a night, on 13.5 kWh units → 3.
    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 20_000,
    });

    expect(sized?.qty).toBe(3);
    expect(sized?.nightKwhPerDay).toBeCloseTo(30.14, 2);
  });

  it("counts by the battery being quoted, not by the system", async () => {
    await sizeToTheHome(55);

    const onSmall = await sizedFor({
      systemType: "pv_storage",
      batteryId: small,
      year1ProductionKwh: 20_000,
    });
    const onBig = await sizedFor({
      systemType: "pv_storage",
      batteryId: big,
      year1ProductionKwh: 20_000,
    });

    // The same 30.14 kWh night: four 10 kWh units, or one 40 kWh one.
    expect(onSmall?.qty).toBe(4);
    expect(onBig?.qty).toBe(1);
  });

  it("sizes a storage-only deal off what the house uses", async () => {
    await sizeToTheHome(55);

    // No array — and a stale production figure from the array this deal is
    // abandoning must not be what it is measured against.
    const sized = await sizedFor({
      systemType: "storage",
      batteryId: powerwall,
      year1ProductionKwh: 90_000,
      annualUsageKwh: 18_000,
    });

    // 18,000 ÷ 365 × 55% = 27.12 kWh → three Powerwalls.
    expect(sized?.nightKwhPerDay).toBeCloseTo(27.12, 2);
    expect(sized?.qty).toBe(3);
  });

  it("counts the adders' own consumption on a storage-only deal", async () => {
    await sizeToTheHome(55);

    const withCharger = await sizedFor({
      systemType: "storage",
      batteryId: powerwall,
      annualUsageKwh: 18_000,
      usageAdjustmentKwh: 4_000,
    });

    // The EV charger this contract sells them is part of the night too:
    // 22,000 ÷ 365 × 55% = 33.15 kWh, which is a third Powerwall's worth.
    expect(withCharger!.nightKwhPerDay).toBeCloseTo(33.15, 2);
    expect(withCharger?.qty).toBe(3);

    // And it genuinely moved the figure — 18,000 alone is 27.12 kWh.
    const without = await sizedFor({
      systemType: "storage",
      batteryId: powerwall,
      annualUsageKwh: 18_000,
    });
    expect(withCharger!.nightKwhPerDay).toBeGreaterThan(without!.nightKwhPerDay);
  });

  it("falls back to usage on a deal whose roof is not drawn yet", async () => {
    await sizeToTheHome(55);

    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 0,
      annualUsageKwh: 20_000,
    });

    expect(sized?.qty).toBe(3);
  });

  it("follows the company's own night share", async () => {
    await sizeToTheHome(30);

    // 20,000 ÷ 365 × 30% = 16.4 kWh → two Powerwalls, not three.
    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 20_000,
    });

    expect(sized?.qty).toBe(2);
  });
});

describe("the rule stands down", () => {
  it("says nothing when the company has not turned it on", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });

    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 20_000,
    });

    expect(sized).toBeNull();
  });

  it("says nothing for a company with no settings row at all", async () => {
    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 20_000,
    });

    expect(sized).toBeNull();
  });

  it("says nothing on a deal quoting panels only", async () => {
    await sizeToTheHome();

    const sized = await sizedFor({
      systemType: "pv",
      batteryId: powerwall,
      year1ProductionKwh: 20_000,
    });

    expect(sized).toBeNull();
  });

  it("says nothing when a person set the count", async () => {
    await sizeToTheHome();

    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      batteryQtySetByRep: true,
      year1ProductionKwh: 20_000,
    });

    expect(sized).toBeNull();
  });

  it("says nothing when there are no figures to size from", async () => {
    await sizeToTheHome();

    // A brand-new deal: no roof drawn, no bill entered. The flat default is
    // the honest answer here, and the next recompute will do better.
    const sized = await sizedFor({
      systemType: "pv_storage",
      batteryId: powerwall,
      year1ProductionKwh: 0,
      annualUsageKwh: null,
    });

    expect(sized).toBeNull();
  });
});

describe("a person's count outlives the rule", () => {
  it("latches the moment a rep types one, and the recompute leaves it alone", async () => {
    await sizeToTheHome();
    await seedDesign({ year1ProductionKwh: 20_000, annualUsageKwh: 20_000, batteryQty: 3 });

    await pick({ batteryQty: 5 });

    const d = await design();
    expect(d?.batteryQty).toBe(5);
    expect(d?.batteryQtySetByRep).toBe(true);
  });

  it("the company's flat default does NOT latch", async () => {
    // Otherwise turning sizing on would find every deal in the pipeline already
    // claiming to have been decided by hand, and size none of them.
    await sizeToTheHome();

    await pick({ batteryId: powerwall });

    expect((await design())?.batteryQtySetByRep).toBe(false);
  });

  it("hands back the count the home needs, not the one that was written first", async () => {
    // What the designer's picker shows while the refresh is in flight. Putting
    // a battery on an empty slot writes the company's flat two and the
    // recompute sizes it a moment later, so an answer taken before that flashes
    // a number the deal does not end up quoting — and on the screen where the
    // count is money, the first number shown is the one a rep believes.
    await sizeToTheHome();
    await seedDesign({
      batteryId: null,
      batteryQty: 0,
      annualUsageKwh: 20_000, // → 30.14 kWh a night → three 13.5 kWh units.
    });

    const res = await pick({ batteryId: powerwall });

    expect(res.ok && res.batteryQty).toBe(3);
    expect((await design())?.batteryQty).toBe(3);
  });

  it("hands back a typed count as the typed count", async () => {
    await sizeToTheHome();
    await seedDesign({ annualUsageKwh: 20_000 });

    const res = await pick({ batteryQty: 5 });

    // Sizing would say three. It stood down, so three is not the answer.
    expect(res.ok && res.batteryQty).toBe(5);
    expect(res.ok && res.batteryQtySetByRep).toBe(true);
  });

  it("swapping the battery hands the count back to the rule", async () => {
    await sizeToTheHome();
    await seedDesign({ year1ProductionKwh: 0, annualUsageKwh: 20_000, batteryQty: 5 });
    await pick({ batteryQty: 5 });
    expect((await design())?.batteryQtySetByRep).toBe(true);

    // Five of one manufacturer's units is not an instruction about five of
    // somebody else's — so the new battery is counted afresh.
    await pick({ batteryId: small });

    const d = await design();
    expect(d?.batteryId).toBe(small);
    expect(d?.batteryQtySetByRep).toBe(false);
  });

  it("hands the count back on request", async () => {
    await sizeToTheHome();
    await seedDesign({ year1ProductionKwh: 0, annualUsageKwh: 20_000 });
    await pick({ batteryQty: 7 });
    expect((await design())?.batteryQtySetByRep).toBe(true);

    await pick({ batteryQtyAuto: true });

    expect((await design())?.batteryQtySetByRep).toBe(false);
  });

  it("taking the battery off releases the latch with it", async () => {
    await sizeToTheHome();
    await seedDesign({ year1ProductionKwh: 0, annualUsageKwh: 20_000 });
    await pick({ batteryQty: 6 });

    await pick({ batteryId: null });

    const d = await design();
    expect(d?.batteryQty).toBe(0);
    expect(d?.batteryQtySetByRep).toBe(false);
  });
});

describe("storage landing on a deal starts at the right count", () => {
  it("takes the sized count, not the flat one, when a deal turns to storage", async () => {
    await sizeToTheHome(55);

    const patch = await runInVertical("solar", () =>
      resolveDesignBattery(companyId, "pv_storage", null, 0, {
        year1ProductionKwh: 20_000,
        annualUsageKwh: null,
        usageAdjustmentKwh: 0,
      })
    );

    expect(patch.batteryId).toBe(powerwall);
    expect(patch.batteryQty).toBe(3);
  });

  it("takes the flat count when the company does not size to the home", async () => {
    await db.solarSettings.create({ data: { companyId, defaultBatteryQty: 2 } });

    const patch = await runInVertical("solar", () =>
      resolveDesignBattery(companyId, "pv_storage", null, 0, {
        year1ProductionKwh: 20_000,
        annualUsageKwh: null,
        usageAdjustmentKwh: 0,
      })
    );

    expect(patch.batteryQty).toBe(2);
  });

  it("takes the flat count when there is nothing to size from yet", async () => {
    await sizeToTheHome(55);

    const patch = await runInVertical("solar", () =>
      resolveDesignBattery(companyId, "pv_storage", null, 0, {
        year1ProductionKwh: 0,
        annualUsageKwh: null,
        usageAdjustmentKwh: 0,
      })
    );

    expect(patch.batteryQty).toBe(2);
  });

  it("going back to panels only clears the count and the latch together", async () => {
    const patch = await runInVertical("solar", () =>
      resolveDesignBattery(companyId, "pv", powerwall, 4)
    );

    expect(patch).toEqual({ batteryId: null, batteryQty: 0, batteryQtySetByRep: false });
  });
});
