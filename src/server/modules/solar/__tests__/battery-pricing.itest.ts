import {
  describe,
  it,
  expect,
  beforeAll,
  beforeEach,
  afterAll,
  vi,
} from "vitest";
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
 * The worked example: 10 kW at a flat $5.50/W is $55,000. A $40,000 battery is
 * grossed up by the programme's 65% dealer fee like the rest of the job, to
 * $114,286, so the contract is $169,286.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

const { generateProposalVersion } = await import("../proposal-generate");

const db = new PrismaClient({
  datasources: { db: { url: TEST_DATABASE_URL } },
});

let companyId: string;
let leadId: string;
let batteryId: string;
let lenderId: string;
let user: SessionUser;

const ARRAY_CENTS = 55_000_00;
const POWERWALL_CENTS = 40_000_00;

/** What the household pays for a battery: its price grossed up by the 65% fee. */
const sticker = (cents: number) => Math.round(cents / (1 - 0.65));

const generate = () =>
  runInVertical("solar", () => generateProposalVersion(user, leadId));

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
      priceRulePpwCents: 550,
      priceRuleMode: "flat",
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
      baseFinalPpwCents: 550,
      dealerFeePct: 65,
      finalPriceCents: ARRAY_CENTS,
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
    data: { baseFinalPerBatteryCents: 0 },
  });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the battery reaches the contract", () => {
  it("adds the catalogue price, grossed up by the fee, to the array's own price", async () => {
    const res = await generate();
    expect(res.ok, "ok" in res && !res.ok ? res.error : "").toBe(true);
    if (!res.ok) return;

    const f = res.snapshot.financing;
    expect(f.equipmentFinalCents).toBe(sticker(POWERWALL_CENTS));
    expect(f.finalPriceCents).toBe(ARRAY_CENTS + sticker(POWERWALL_CENTS));
    // The array is still sold at exactly the partner's published rate: the
    // battery rides above the ceiling rather than eating into what the company
    // keeps on the system.
    expect(f.baseFinalCents).toBe(ARRAY_CENTS);
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
      (f.baseFinalCents ?? 0) +
        (f.addersFinalCents ?? 0) +
        (f.equipmentFinalCents ?? 0),
    ).toBe(f.finalPriceCents);
  });

  it("moves the DEAL's value, which is the number that started this", async () => {
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    const lead = await db.lead.findUniqueOrThrow({
      where: { id: leadId },
      select: { value: true },
    });
    // `Lead.value` is the household's NET after the credits their document
    // quotes (solar/deal-value.ts), so it is read off that document's own
    // ladder — which is priced on a contract with the fee-grossed battery in it.
    // The array alone is worth less than $55,000 net; this deal is worth more.
    const f = res.snapshot.financing;
    expect(f.finalPriceCents).toBe(ARRAY_CENTS + sticker(POWERWALL_CENTS));
    expect(lead.value).toBe(f.creditLadder?.netCostCents ?? f.finalPriceCents);
    expect(lead.value).toBeGreaterThan(ARRAY_CENTS);
  });

  it("writes the priced contract back onto the deal's own finance row", async () => {
    await generate();
    const row = await db.solarFinance.findUniqueOrThrow({
      where: { leadId },
      select: { finalPriceCents: true },
    });
    expect(row.finalPriceCents).toBe(ARRAY_CENTS + sticker(POWERWALL_CENTS));
  });

  it("charges for every battery on the roof", async () => {
    await db.solarDesign.update({ where: { leadId }, data: { batteryQty: 2 } });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.equipmentFinalCents).toBe(sticker(POWERWALL_CENTS * 2));
    expect(res.snapshot.financing.finalPriceCents).toBe(
      ARRAY_CENTS + sticker(POWERWALL_CENTS * 2),
    );
  });

  it("charges every option on the menu for it, under that option's own fee", async () => {
    // The battery is on the roof whichever way the household pays. A menu that
    // charged for it on the loan and not in the cash column would be comparing
    // two different houses. Cash has no fee to gross it up by; the loan does.
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    const purchases = (res.snapshot.options ?? []).filter(
      (o) => o.financing.product === "cash" || o.financing.product === "loan",
    );
    expect(purchases.length).toBeGreaterThan(1);
    for (const o of purchases) {
      expect(o.financing.equipmentFinalCents).toBe(
        o.financing.product === "cash" ? POWERWALL_CENTS : sticker(POWERWALL_CENTS),
      );
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
    expect(frozen.financing.equipmentFinalCents).toBe(sticker(POWERWALL_CENTS));
    expect(frozen.financing.finalPriceCents).toBe(
      ARRAY_CENTS + sticker(POWERWALL_CENTS),
    );
  });

  it("prices the NEXT version at the new figure", async () => {
    await db.solarEquipment.update({
      where: { id: batteryId },
      data: { priceCents: 60_000_00 },
    });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.equipmentFinalCents).toBe(sticker(60_000_00));
  });

  it("yields to a price typed on the deal itself", async () => {
    // A rep who has agreed a figure with a household keeps it, whatever
    // Settings says this week.
    await db.solarFinance.update({
      where: { leadId },
      data: { baseFinalPerBatteryCents: 32_000_00 },
    });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.equipmentFinalCents).toBe(sticker(32_000_00));
    expect(res.snapshot.financing.finalPriceCents).toBe(
      ARRAY_CENTS + sticker(32_000_00),
    );
  });
});

describe("a storage-only deal is not billed twice", () => {
  it("prices the battery as the system, and adds nothing on top of it", async () => {
    // There the battery IS the system and climbs the per-battery ladder. Adding
    // the catalogue price again would put one Powerwall on the contract twice.
    //
    // A storage-only job has its own gate before it may generate: the paper has
    // to be a programme that funds a battery on its own.
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
        baseFinalPerBatteryCents: POWERWALL_CENTS,
        baseFinalPpwCents: 0,
        lenderProductId: storageProduct.id,
      },
    });

    const res = await generate();
    if (!res.ok) throw new Error(JSON.stringify(res));
    const f = res.snapshot.financing;
    expect(f.equipmentFinalCents).toBeUndefined();
    expect(f.finalPriceCents).toBe(POWERWALL_CENTS);
  });
});

/**
 * What the document is allowed to say about how long the battery lasts.
 *
 * Through `generateProposalVersion`, not against the pure function: the pure
 * function had tests the whole time the snapshot was being built from a list of
 * named load profiles, and a runtime derived correctly from arguments the
 * generator never passes is a test that cannot fail.
 */
describe("the runtime a storage proposal freezes", () => {
  /** Flip the deal to storage-only on paper that funds one. */
  async function storageOnly() {
    const product = await db.solarLenderProduct.create({
      data: {
        companyId,
        lenderId,
        product: "loan",
        name: `battery-${Date.now()}`,
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
        baseFinalPerBatteryCents: POWERWALL_CENTS,
        baseFinalPpwCents: 0,
        lenderProductId: product.id,
      },
    });
  }

  it("is ONE whole-home row, divided out of the home's own usage", async () => {
    await storageOnly();
    const res = await generate();
    if (!res.ok) throw new Error(JSON.stringify(res));

    const st = res.snapshot.storage!;
    // One row, not the three coverage tiers the company used to keep in
    // Settings. Every install here is whole-home backup, so a menu of
    // "Essentials / Essentials + AC / Whole home" described a product nobody
    // sells — and one company-wide wattage quoted every house the same hours.
    expect(st.backup).toHaveLength(1);
    expect(st.backup[0].name).toBe("Whole home");

    // 13,000 kWh ÷ 8,760 h = 1,484 W average, × 1.3 = 1,929 W while the grid is
    // down, and one 13.5 kWh Powerwall carries that for seven hours.
    expect(st.backup[0].loadWatts).toBeCloseTo(1929.2, 1);
    expect(st.backup[0].hours).toBeCloseTo(7.0, 1);

    // And the assumptions are frozen BESIDE the figure they produced, so a
    // factor the company changes next month cannot silently rewrite the
    // runtime on a document somebody has already signed.
    expect(st.backupBasis).toEqual({
      annualUsageKwh: 13_000,
      averageLoadWatts: expect.closeTo(1484.0, 1),
      outageDrawFactor: 1.3,
    });
  });

  it("follows the company's factor, and records the one it used", async () => {
    await db.solarSettings.upsert({
      where: { companyId },
      create: { companyId, backupOutageDrawFactor: 2 },
      update: { backupOutageDrawFactor: 2 },
    });
    await storageOnly();
    const res = await generate();
    if (!res.ok) throw new Error(JSON.stringify(res));

    const st = res.snapshot.storage!;
    // Twice the draw is half the hours, and the document carries the 2 that
    // did it rather than leaving a reader to guess.
    expect(st.backup[0].loadWatts).toBeCloseTo(2968.0, 1);
    expect(st.backup[0].hours).toBeCloseTo(4.5, 1);
    expect(st.backupBasis?.outageDrawFactor).toBe(2);

    await db.solarSettings.update({
      where: { companyId },
      data: { backupOutageDrawFactor: 1.3 },
    });
  });

  it("cannot be generated at all with no usage on file", async () => {
    // The runtime is divided out of this house's usage, so a blank Energy step
    // leaves the document unable to say either of the two things a battery is
    // bought for. It used to be a warning — the hours came from the company's
    // profile list either way and only the bill saving went missing — and the
    // block that replaced it is the one that used to fire when a company had
    // no profiles at all.
    await storageOnly();
    await db.solarDesign.update({
      where: { leadId },
      data: { annualUsageKwh: null },
    });
    const res = await generate();
    await db.solarDesign.update({
      where: { leadId },
      data: { annualUsageKwh: 13_000 },
    });

    expect(res.ok).toBe(false);
    if (res.ok) throw new Error("expected the generator to refuse");
    expect(res.issues?.map((i) => i.code)).toContain("storage.no_usage");
  });
});
