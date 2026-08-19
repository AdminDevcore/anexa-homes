import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { annualUsageFromBill, resolveUtilityRateMills } from "@/lib/solar-energy";
import { listSolarProviders } from "@/server/modules/solar/providers";
import { addressChanged } from "@/server/modules/geo/resolve";

/**
 * Whichever way a rep enters consumption, the row that comes out has to be
 * consistent: one annual usage figure, and a rate that resolves.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Energy Co", slug: `en-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "En", lastName: "Test" },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarProvider.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("entering consumption from the bill", () => {
  it("stores a derived annual usage alongside the typed rate", async () => {
    const usage = annualUsageFromBill(20_000, 200);
    expect(usage).toBe(12_000);

    await db.solarDesign.create({
      data: {
        companyId, leadId, usageBasis: "bill",
        avgMonthlyBillCents: 20_000, utilityRateMills: 200, annualUsageKwh: usage,
      },
    });

    const row = await db.solarDesign.findUnique({ where: { leadId } });
    expect(row?.annualUsageKwh).toBe(12_000);
    expect(row?.utilityRateMills).toBe(200);
    // The rate the customer told us, not one worked back out of the bill.
    expect(resolveUtilityRateMills(row!)).toBe(200);
  });
});

describe("entering consumption from usage", () => {
  it("leaves the rate null so it stays derived from the bill", async () => {
    await db.solarDesign.create({
      data: {
        companyId, leadId, usageBasis: "usage",
        annualUsageKwh: 14_000, avgMonthlyBillCents: 18_000, utilityRateMills: null,
      },
    });

    const row = await db.solarDesign.findUnique({ where: { leadId } });
    expect(row?.utilityRateMills).toBeNull();
    expect(resolveUtilityRateMills(row!)).toBe(154);
  });
});

describe("the provider lists", () => {
  it("offers only active providers", async () => {
    await db.solarProvider.createMany({
      data: [
        { companyId, kind: "utility", name: "Oncor", position: 0 },
        { companyId, kind: "utility", name: "Old Utility", position: 1, active: false },
        { companyId, kind: "retail", name: "Rhythm Energy", position: 0 },
      ],
    });

    const utilities = await runInVertical("solar", () => listSolarProviders(companyId, "utility"));
    expect(utilities.map((u) => u.name)).toEqual(["Oncor"]);
  });

  it("keeps a retired provider a design already names, so a save cannot blank it", async () => {
    await db.solarProvider.createMany({
      data: [
        { companyId, kind: "utility", name: "Oncor", position: 0 },
        { companyId, kind: "utility", name: "Old Utility", position: 1, active: false },
      ],
    });

    const utilities = await runInVertical("solar", () =>
      listSolarProviders(companyId, "utility", "Old Utility")
    );
    expect(utilities.map((u) => u.name).sort()).toEqual(["Old Utility", "Oncor"]);
  });

  it("does not reach into another company's list", async () => {
    const other = await db.company.create({
      data: { name: "Other Providers Co", slug: `op-${process.pid}-${Date.now()}` },
    });
    await db.solarProvider.create({ data: { companyId: other.id, kind: "utility", name: "Theirs" } });

    const mine = await runInVertical("solar", () => listSolarProviders(companyId, "utility"));
    expect(mine).toEqual([]);

    await db.company.deleteMany({ where: { id: other.id } });
  });
});

describe("correcting an address invalidates the pin", () => {
  it("is what makes the designer re-frame on the new house", async () => {
    // Null coordinates are the signal the satellite route re-geocodes on. If a
    // corrected address did not clear them, the roof would stay the old one.
    const moved = addressChanged(
      { address: "1 Old St", city: "Dallas", state: "TX", zip: "75204" },
      { address: "2 New St", city: "Dallas", state: "TX", zip: "75204" }
    );
    expect(moved).toBe(true);

    const same = addressChanged(
      { address: "1 Old St", city: "Dallas", state: "TX", zip: "75204" },
      { address: "1 Old St", city: "Dallas", state: "TX", zip: "75204" }
    );
    expect(same).toBe(false);
  });
});
