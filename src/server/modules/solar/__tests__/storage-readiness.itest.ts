import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { readSolarReadiness } from "@/server/modules/solar/readiness";

/**
 * Readiness on a deal with no array, tested THROUGH THE READER.
 *
 * `validateDesign` already had unit tests and they all passed — because they
 * handed it `systemType: "storage"` by hand. The reader never passed it, so
 * every storage deal in the product was told "system size must be greater than
 * zero", "module quantity must be at least one" and "no panel layout has been
 * drawn": four findings about an array, on a battery, none of them clearable.
 *
 * A pure function tested with the argument its caller forgets to supply is a
 * test that cannot fail. These go through `readSolarReadiness`.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let batteryId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Storage Readiness Co", slug: `sr-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id,
      firstName: "Bat", lastName: "Tester",
      address: "1 Battery Way", city: "Richardson", state: "TX", zip: "75081",
    },
  });
  leadId = lead.id;
  const battery = await db.solarEquipment.create({
    data: { companyId, kind: "battery", manufacturer: "Tesla", model: "Powerwall 3", ratingW: 13500 },
  });
  batteryId = battery.id;
  await db.solarBackupProfile.create({
    data: { companyId, name: "Essentials", loadWatts: 1000, rank: 0 },
  });
});

beforeEach(async () => {
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarFinance.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

/** A complete storage deal: battery, count, and a price on a cash product. */
async function storageDeal(overrides: Record<string, unknown> = {}) {
  await db.solarDesign.create({
    data: {
      companyId, leadId,
      systemType: "storage",
      batteryId, batteryQty: 2,
      annualUsageKwh: 12_000,
      avgMonthlyBillCents: 250_00,
      utilityRateMills: 150,
      ...overrides,
    },
  });
  await db.solarFinance.create({
    data: {
      companyId, leadId,
      product: "cash",
      dealerFeePct: 0,
      stickerPricePerBatteryCents: 13_000_00,
      contractPriceCents: 26_000_00,
    },
  });
}

const codes = async () => {
  const r = await runInVertical("solar", () => readSolarReadiness(companyId, leadId));
  if (!r.ok) throw new Error(r.error);
  return r.issues.map((i) => i.code);
};

describe("readiness on a storage deal", () => {
  it("does not ask a battery for an array", async () => {
    await storageDeal();
    const found = await codes();
    // The four findings a storage deal used to be blocked by, permanently.
    for (const code of [
      "design.size_zero",
      "equipment.no_module",
      "equipment.module_qty_zero",
    ]) {
      expect(found).not.toContain(code);
    }
    expect(found.join(" ")).not.toMatch(/offset|layout/i);
  });

  it("blocks on the things a battery deal actually needs", async () => {
    await storageDeal({ batteryId: null, batteryQty: 0 });
    const found = await codes();
    expect(found).toContain("storage.no_battery");
    expect(found).toContain("storage.no_qty");
  });

  it("blocks when the company has no backup profile to state hours from", async () => {
    await db.solarBackupProfile.deleteMany({ where: { companyId } });
    await storageDeal();
    expect(await codes()).toContain("storage.no_backup_profile");
    await db.solarBackupProfile.create({
      data: { companyId, name: "Essentials", loadWatts: 1000, rank: 0 },
    });
  });

  it("still demands an array on a pv deal read through the same reader", async () => {
    await db.solarDesign.create({
      data: {
        companyId, leadId,
        systemType: "pv",
        annualUsageKwh: 12_000,
        avgMonthlyBillCents: 250_00,
        utilityRateMills: 150,
      },
    });
    await db.solarFinance.create({
      data: { companyId, leadId, product: "cash", dealerFeePct: 0, grossPpwCents: 350 },
    });
    expect(await codes()).toContain("design.size_zero");
  });
});
