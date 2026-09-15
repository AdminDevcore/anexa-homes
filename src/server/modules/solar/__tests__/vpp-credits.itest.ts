import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { resolveVppCredits } from "@/server/modules/solar/vpp-credits";

/**
 * Whether a battery programme's money reaches a customer's proposal.
 *
 * The eligibility RULE is unit-tested in solar-provider-terms; what needs a
 * real database is the resolution around it — matching the deal's provider by
 * the NAME a design stores, reading the join tables, and multiplying by a
 * battery count that is very often zero on a design that plainly has a battery.
 *
 * These run against `runInVertical`-free plain Prisma on purpose: the resolver
 * is called from proposal generation, which is already inside the solar
 * workspace by the time it runs.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let batteryId: string;
let otherBatteryId: string;
let lenderId: string;
let productId: string;
let otherProductId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "VPP Credit Co", slug: `vpp-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;

  const battery = await db.solarEquipment.create({
    data: { companyId, kind: "battery", manufacturer: "Tesla", model: "Powerwall 3", ratingW: 13_500 },
  });
  batteryId = battery.id;
  const other = await db.solarEquipment.create({
    data: { companyId, kind: "battery", manufacturer: "Enphase", model: "IQ 5P", ratingW: 5_000 },
  });
  otherBatteryId = other.id;

  const lender = await db.solarLender.create({ data: { companyId, name: "Amos Capital Fund" } });
  lenderId = lender.id;
  const p = await db.solarLenderProduct.create({
    data: { companyId, lenderId, product: "loan", aprPct: 4.99, termMonths: 300 },
  });
  productId = p.id;
  const p2 = await db.solarLenderProduct.create({
    data: { companyId, lenderId, product: "loan", aprPct: 2.99, termMonths: 120 },
  });
  otherProductId = p2.id;
});

beforeEach(async () => {
  await db.solarProvider.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

/** A utility that pays $400 a year per battery, with no conditions recorded. */
async function oncor(over: Record<string, unknown> = {}) {
  return db.solarProvider.create({
    data: {
      companyId,
      kind: "utility",
      name: "Oncor Electric Delivery",
      vpp: true,
      vppProgramme: "Renew Home",
      vppAnnualCents: 40_000,
      ...over,
    },
  });
}

/** The deal in front of us: a Tesla, on the Amos loan, on Oncor. */
const DEAL = {
  utilityProvider: "Oncor Electric Delivery",
  electricProvider: "TXU Energy",
  batteryQty: 1,
  financeProduct: "loan" as const,
};

describe("what a deal's battery earns", () => {
  it("credits an unconditional programme the deal's provider runs", async () => {
    await oncor();
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([
      {
        programme: "Renew Home",
        provider: "Oncor Electric Delivery",
        annualCents: 40_000,
        upfrontCents: 0,
        batteryQty: 1,
      },
    ]);
  });

  it("treats a battery chosen with NO quantity as one battery", async () => {
    // The bug this test exists for. Every design in production had a battery
    // selected and `batteryQty` left at its 0 default, because the quantity box
    // is optional on the designer and nobody opens it — and the equipment card
    // on the proposal already prints "1 total" for exactly that row. Reading it
    // literally would have shown a homeowner one battery and credited none.
    await oncor();
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: 0, batteryId,
      batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0]?.annualCents).toBe(40_000);
    expect(credits[0]?.batteryQty).toBe(1);
  });

  it("multiplies by a real quantity when one is typed", async () => {
    await oncor({ vppUpfrontCents: 50_000 });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: 3, batteryId,
      batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0].annualCents).toBe(120_000);
    expect(credits[0].upfrontCents).toBe(150_000);
  });

  it("earns nothing on a design with no battery at all", async () => {
    await oncor();
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId: null, batteryQty: 0,
      batteryLabel: null, financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });

  it("ignores a provider this deal does not name", async () => {
    await oncor({ name: "CenterPoint Energy" });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });

  it("reads the RETAILER as well as the utility", async () => {
    // Texas splits the two companies, and the programme may be run by either.
    await oncor({ name: "TXU Energy", kind: "retail" });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits.map((c) => c.provider)).toEqual(["TXU Energy"]);
  });
});

describe("the programme's conditions gate the money", () => {
  it("pays nothing when the battery is not one the programme enrols", async () => {
    const p = await oncor();
    await db.solarProviderVppEquipment.create({
      data: { providerId: p.id, equipmentId: otherBatteryId },
    });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });

  it("pays when the battery IS on the list", async () => {
    const p = await oncor();
    await db.solarProviderVppEquipment.create({ data: { providerId: p.id, equipmentId: batteryId } });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0]?.annualCents).toBe(40_000);
  });

  it("pays nothing on a way of paying the programme does not take", async () => {
    await oncor({ vppFinanceProducts: ["cash"] });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });

  it("pays nothing on a loan product outside the programme's list", async () => {
    const p = await oncor({ vppFinanceProducts: ["loan"] });
    await db.solarProviderVppProduct.create({ data: { providerId: p.id, productId } });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3",
      financeProductId: otherProductId,
    });
    expect(credits).toEqual([]);
  });

  it("pays nothing at all when the programme records no money", async () => {
    // The flag on its own says "they run one"; it does not say what it is worth,
    // and a programme worth nothing must not print a $0 line on a proposal.
    await oncor({ vppAnnualCents: null });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });

  it("ignores a provider whose programme flag is off", async () => {
    await oncor({ vpp: false });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });
});

/**
 * THE CEILING, end to end.
 *
 * The unit table lives in lib/__tests__/solar-vpp-cap.test.ts; this proves the
 * resolver actually applies it and that the count it reports alongside is the
 * count the money was worked out from — the customer's card divides one by the
 * other to print a per-battery rate.
 */
describe("a programme will only pay for so many batteries", () => {
  it("pays the full rate up to six", async () => {
    await oncor();
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: 6,
      batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0].annualCents).toBe(6 * 40_000);
    expect(credits[0].batteryQty).toBe(6);
  });

  it("CAPS a seventh battery, and everything above it", async () => {
    await oncor();
    for (const qty of [7, 10, 40]) {
      const credits = await resolveVppCredits({
        companyId, ...DEAL, batteryQty: qty,
        batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
      });
      expect(credits[0].annualCents, `${qty} batteries`).toBe(6 * 40_000);
      // The reported count is capped too, so the per-battery rate the customer's
      // card derives stays the rate the programme actually publishes.
      expect(credits[0].batteryQty).toBe(6);
      expect(credits[0].annualCents / credits[0].batteryQty).toBe(40_000);
    }
  });

  it("honours a programme that states its own, lower ceiling", async () => {
    await oncor({ vppMaxBatteries: 2 });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: 9,
      batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0].annualCents).toBe(2 * 40_000);
    expect(credits[0].batteryQty).toBe(2);
  });

  it("caps the enrolment money by the same count", async () => {
    await oncor({ vppUpfrontCents: 10_000 });
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: 12,
      batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits[0].upfrontCents).toBe(6 * 10_000);
    expect(credits[0].annualCents).toBe(6 * 40_000);
  });

  it("earns nothing on a negative quantity rather than reading it as one", async () => {
    await oncor();
    const credits = await resolveVppCredits({
      companyId, ...DEAL, batteryQty: -3,
      batteryId, batteryLabel: "Tesla Powerwall 3", financeProductId: productId,
    });
    expect(credits).toEqual([]);
  });
});
