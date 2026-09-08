import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import type { SessionUser } from "@/server/auth/session";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";

/**
 * A BATTERY BESIDE AN ARRAY IS CHARGED FOR — end to end, through the real
 * generator and a real database.
 *
 * The defect: a rep attached a $40,000 Powerwall to a 10 kW system and the deal
 * value did not move a cent. The price of a solar job is a rate per WATT, a
 * battery has no watts of its own, and `SolarEquipment.priceCents` — the box
 * headed "Price" on the catalogue's own Pricing tab — was read by nothing that
 * priced anything. The company gave the storage away on every such deal.
 *
 * None of what matters here can be seen in a pure function. Whether the
 * contract on the ROW moved, whether the figure survives an edit to the
 * catalogue afterwards, and whether a storage-only deal is billed for its
 * battery twice are all questions about rows and about time.
 *
 * The worked example: 10 kW at a flat $5.50/W is $55,000, a $40,000 battery on
 * top makes the contract $95,000.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

const { generateProposalVersion } = await import("../proposal-generate");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let batteryId: string;
let lenderId: string;
let user: SessionUser;

const ARRAY_CENTS = 55_000_00;
const POWERWALL_CENTS = 40_000_00;

const generate = () => runInVertical("solar", () => generateProposalVersion(user, leadId));

async function snapshotOf(id: string): Promise<SolarProposalSnapshot> {
  const row = await db.solarProposal.findUniqueOrThrow({
    where: { id },
    select: { snapshot: true },
  });
  return row.snapshot as unknown as SolarProposalSnapshot;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: {
      name: "Battery Price Test Co",
      slug: `batt-${process.pid}-${Date.now()}`,
      phone: "(866) 650-9996",
      email: "support@example.com",
      address: "1 Test Way",
      city: "Dallas",
      state: "TX",
      zip: "75001",
    },
  });
  companyId = company.id;

  const owner = await db.user.create({
    data: {
      companyId,
      email: `owner-${process.pid}-${Date.now()}@example.com`,
      firstName: "Ola",
      lastName: "Owner",
      role: "super_admin",
    },
  });
  user = {
    userId: owner.id,
    companyId,
    role: "super_admin",
    fullName: "Ola Owner",
    permissions: {},
  } as unknown as SessionUser;
  requireUser.mockResolvedValue(user);

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId: pipeline.id,
      stageId: stage.id,
      firstName: "Dana",
      lastName: "Ortiz",
      address: "18 Storage Row",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      lat: 32.78,
      lng: -96.8,
    },
  });
  leadId = lead.id;

  const panel = await db.solarEquipment.create({
    data: {
      companyId,
      kind: "module",
      manufacturer: "Qcells",
      model: `Q.PEAK-${process.pid}`,
      ratingW: 400,
      widthMm: 1134,
      heightMm: 1879,
    },
  });

  // The catalogue row this whole feature is about: a battery with a price on
  // it, entered in Settings → Solar Equipment → Pricing.
  const battery = await db.solarEquipment.create({
    data: {
      companyId,
      kind: "battery",
      manufacturer: "Tesla",
      model: `Powerwall-${process.pid}`,
      ratingW: 13_500,
      priceCents: POWERWALL_CENTS,
    },
  });
  batteryId = battery.id;

  // Amos's shape: a flat $5.50/W to the household on a 65% fee.
  const lender = await db.solarLender.create({
    data: {
      companyId,
      name: "Flat Rate Partner",
      maxFinalPpwCents: 550,
      finalPpwMode: "flat",
    },
  });
  lenderId = lender.id;

  const product = await db.solarLenderProduct.create({
    data: {
      companyId,
      lenderId: lender.id,
      product: "loan",
      name: "30 yr · 0.00%",
      aprPct: 0,
      termMonths: 360,
      dealerFeePct: 65,
    },
  });

  await db.solarDesign.create({
    data: {
      companyId,
      leadId,
      lenderId: lender.id,
      systemType: "pv_storage",
      moduleId: panel.id,
      moduleQty: 25,
      batteryId,
      batteryQty: 1,
      systemSizeKwDc: 10,
      year1ProductionKwh: 12_180,
      annualUsageKwh: 13_000,
      offsetPct: 93,
      avgMonthlyBillCents: 21_000,
      utilityRateMills: 150,
      utilityProvider: "Oncor",
      layoutImageFileId: "00000000-0000-0000-0000-000000000001",
    },
  });

  await db.solarFinance.create({
    data: {
      companyId,
      leadId,
      product: "loan",
      lenderProductId: product.id,
      grossPpwCents: 550,
      dealerFeePct: 65,
      contractPriceCents: ARRAY_CENTS,
      aprPct: 0,
      loanTermMonths: 360,
    },
  });
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
  await db.solarEquipment.update({
    where: { id: batteryId },
    data: { priceCents: POWERWALL_CENTS },
  });
  await db.solarDesign.update({
    where: { leadId },
    data: { systemType: "pv_storage", batteryQty: 1 },
  });
  await db.solarFinance.update({
    where: { leadId },
    data: { stickerPricePerBatteryCents: 0 },
  });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the battery reaches the contract", () => {
  it("adds the catalogue price on top of the array's own price", async () => {
    const res = await generate();
    expect(res.ok, "ok" in res && !res.ok ? res.error : "").toBe(true);
    if (!res.ok) return;

    const f = res.snapshot.financing;
    expect(f.batteryPriceCents).toBe(POWERWALL_CENTS);
    expect(f.contractPriceCents).toBe(ARRAY_CENTS + POWERWALL_CENTS);
    // The array is still sold at exactly the partner's published rate: the
    // battery rides above the ceiling rather than eating into what the company
    // keeps on the system.
    expect(f.basePriceCents).toBe(ARRAY_CENTS);
  });

  it("names it, so a household reading $40,000 is told what it is for", async () => {
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.batteryLabel).toContain("Tesla");
    expect(res.snapshot.financing.batteryQty).toBe(1);
  });

  it("leaves the customer's own breakdown adding up to its total", async () => {
    // The rows on the cost sheet, in the order a homeowner adds them up:
    // system price, plus additional work, plus the battery, equals the total.
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    const f = res.snapshot.financing;
    expect(
      (f.basePriceCents ?? 0) + (f.adderTotalCents ?? 0) + (f.batteryPriceCents ?? 0)
    ).toBe(f.contractPriceCents);
  });

  it("moves the DEAL's value, which is the number that started this", async () => {
    await generate();
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { value: true },
    });
    expect(lead.value).toBe(ARRAY_CENTS + POWERWALL_CENTS);
  });

  it("writes the priced contract back onto the deal's own finance row", async () => {
    await generate();
    const row = await db.solarFinance.findUniqueOrThrow({
      where: { leadId },
      select: { contractPriceCents: true },
    });
    expect(row.contractPriceCents).toBe(ARRAY_CENTS + POWERWALL_CENTS);
  });

  it("charges for every battery on the roof", async () => {
    await db.solarDesign.update({ where: { leadId }, data: { batteryQty: 2 } });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.batteryPriceCents).toBe(POWERWALL_CENTS * 2);
    expect(res.snapshot.financing.contractPriceCents).toBe(ARRAY_CENTS + POWERWALL_CENTS * 2);
  });

  it("charges every option on the menu the same for it", async () => {
    // The battery is on the roof whichever way the household pays. A menu that
    // charged for it on the loan and not in the cash column would be comparing
    // two different houses.
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    const purchases = (res.snapshot.options ?? []).filter(
      (o) => o.financing.product === "cash" || o.financing.product === "loan"
    );
    expect(purchases.length).toBeGreaterThan(1);
    for (const o of purchases) {
      expect(o.financing.batteryPriceCents).toBe(POWERWALL_CENTS);
    }
  });
});

describe("what a catalogue edit may and may not move", () => {
  it("does not re-price a version already generated", async () => {
    const first = await generate();
    if (!first.ok) throw new Error(first.error);

    await db.solarEquipment.update({
      where: { id: batteryId },
      data: { priceCents: 60_000_00 },
    });

    const frozen = await snapshotOf(first.id);
    expect(frozen.financing.batteryPriceCents).toBe(POWERWALL_CENTS);
    expect(frozen.financing.contractPriceCents).toBe(ARRAY_CENTS + POWERWALL_CENTS);
  });

  it("prices the NEXT version at the new figure", async () => {
    await db.solarEquipment.update({
      where: { id: batteryId },
      data: { priceCents: 60_000_00 },
    });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.batteryPriceCents).toBe(60_000_00);
  });

  it("yields to a price typed on the deal itself", async () => {
    // A rep who has agreed a figure with a household keeps it, whatever
    // Settings says this week.
    await db.solarFinance.update({
      where: { leadId },
      data: { stickerPricePerBatteryCents: 32_000_00 },
    });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.batteryPriceCents).toBe(32_000_00);
    expect(res.snapshot.financing.contractPriceCents).toBe(ARRAY_CENTS + 32_000_00);
  });
});

describe("a storage-only deal is not billed twice", () => {
  it("prices the battery as the system, and adds nothing on top of it", async () => {
    // There the battery IS the system and climbs the per-battery ladder. Adding
    // the catalogue price again would put one Powerwall on the contract twice.
    //
    // A storage-only job has its own two gates before it may generate: the
    // company needs a load profile for the backup table to be built from, and
    // the paper has to be a programme that funds a battery on its own.
    await db.solarBackupProfile.create({
      data: { companyId, name: "Essentials", loadWatts: 1_500, rank: 1 },
    });
    const storageProduct = await db.solarLenderProduct.create({
      data: {
        companyId,
        lenderId,
        product: "loan",
        name: "20 yr battery",
        aprPct: 0,
        termMonths: 240,
        dealerFeePct: 65,
        financesStorageOnly: true,
      },
    });
    await db.solarDesign.update({
      where: { leadId },
      data: { systemType: "storage", batteryQty: 1 },
    });
    await db.solarFinance.update({
      where: { leadId },
      data: {
        stickerPricePerBatteryCents: POWERWALL_CENTS,
        grossPpwCents: 0,
        lenderProductId: storageProduct.id,
      },
    });

    const res = await generate();
    if (!res.ok) throw new Error(JSON.stringify(res));
    const f = res.snapshot.financing;
    expect(f.batteryPriceCents).toBeUndefined();
    expect(f.contractPriceCents).toBe(POWERWALL_CENTS);
  });
});
