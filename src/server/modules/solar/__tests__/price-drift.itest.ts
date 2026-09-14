import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { priceStoredPurchase, batteryChargeCents } from "@/lib/solar-money";

/**
 * THE CACHED CONTRACT CANNOT BE LEFT BEHIND.
 *
 * `SolarFinance` holds inputs a person typed and figures derived from them.
 * `contractPriceCents` is derived — a cache — and it used to be written only
 * when the financing step itself was saved. Everything else that moves the
 * price wrote its own table and left it alone, so a deal could sit at
 * $30,695.12 in the column while every screen that recomputed showed
 * $74,695.12.
 *
 * Most readers recompute and were never wrong. `lender-submit.ts` does not: it
 * sends `contractPriceCents − downPayment` as the amount a partner is asked to
 * underwrite. That is what makes this a money bug rather than a cosmetic one.
 *
 * Each test below moves ONE thing and asserts the cache followed. The expected
 * figure is computed independently, through `priceStoredPurchase` — the same
 * function every reading screen uses — so the assertion is "the stored column
 * agrees with what the app would derive", not "the code agrees with itself".
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveSolarFinanceAction, setSolarDealLenderAction } = await import("../actions");
const { setSolarDesignEquipmentAction } = await import("../equipment-actions");
const { addDealAdderAction, removeDealAdderAction } = await import("../adder-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let moduleId: string;
let batteryId: string;
let cheapLender: string;
let dearLender: string;

const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);
const finance = () => db.solarFinance.findUniqueOrThrow({ where: { leadId } });
const design = () => db.solarDesign.findUniqueOrThrow({ where: { leadId } });

/**
 * What the contract SHOULD be, derived the way every screen derives it.
 *
 * Deliberately not a call into the module under test: if both sides shared an
 * implementation the test would only prove the code is self-consistent, which
 * is exactly what it was while being wrong.
 */
async function expectedContract(): Promise<number> {
  const f = await finance();
  const d = await db.solarDesign.findUniqueOrThrow({
    where: { leadId },
    select: {
      systemSizeKwDc: true,
      systemType: true,
      batteryQty: true,
      battery: { select: { priceCents: true } },
      lender: { select: { maxFinalPpwCents: true, finalPpwMode: true } },
    },
  });
  return priceStoredPurchase({
    product: f.product as "cash" | "loan",
    systemSizeKwDc: d.systemSizeKwDc,
    stickerPpwCents: f.grossPpwCents,
    dealerFeePct: f.dealerFeePct,
    adderTotalCents: f.adderTotalCents,
    onTopAdderTotalCents: f.onTopAdderTotalCents,
    batteryPriceCents: batteryChargeCents({
      systemType: d.systemType,
      batteryQty: d.batteryQty,
      dealPerBatteryCents: f.stickerPricePerBatteryCents,
      cataloguePerBatteryCents: d.battery?.priceCents ?? null,
    }),
    maxFinalPpwCents: d.lender?.maxFinalPpwCents ?? null,
    finalPpwMode: d.lender?.finalPpwMode,
  }).breakdown.contractPriceCents;
}

/** The assertion this whole file exists for. */
async function expectInStep() {
  const stored = (await finance()).contractPriceCents;
  expect(stored).toBe(await expectedContract());
  return stored;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Drift Co", slug: `drift-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  const user = await db.user.create({
    data: {
      companyId, email: `drift-${process.pid}@test.local`,
      firstName: "Dee", lastName: "Rift", role: "super_admin", passwordHash: "x",
    },
    select: { id: true },
  });
  session.requireUser.mockResolvedValue({
    userId: user.id, companyId, role: "super_admin", permissions: {}, fullName: "Dee Rift",
  });

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "qualified", name: "Qualified", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Drift", lastName: "Deal",
    },
  });
  leadId = lead.id;

  moduleId = (await db.solarEquipment.create({
    data: { companyId, kind: "module", manufacturer: "Qcells", model: "Q.PEAK", ratingW: 400, priceCents: 0 },
    select: { id: true },
  })).id;
  batteryId = (await db.solarEquipment.create({
    data: { companyId, kind: "battery", manufacturer: "Tesla", model: "PW3", ratingW: 13500, priceCents: 1_400_000 },
    select: { id: true },
  })).id;

  cheapLender = (await db.solarLender.create({
    data: { companyId, name: "Cheap Money" }, select: { id: true },
  })).id;
  // A dear partner: same deal, different fee, therefore a different contract.
  dearLender = (await db.solarLender.create({
    data: { companyId, name: "Dear Money" }, select: { id: true },
  })).id;
});

beforeEach(async () => {
  await db.solarDealAdder.deleteMany({ where: { leadId } });
  await db.solarFinance.deleteMany({ where: { leadId } });
  await db.solarDesign.deleteMany({ where: { leadId } });
  await db.solarDesign.create({
    data: {
      companyId, leadId, vertical: "solar", systemType: "pv",
      moduleId, moduleQty: 30, systemSizeKwDc: 12,
      /**
       * A REAL DRAWN ARRAY, not just a size column.
       *
       * `recomputeDesignFigures` derives the system size from the layout, so a
       * fixture that sets `systemSizeKwDc` without any blocks is re-derived to
       * zero the first time anything recomputes — correctly, since no panels
       * are drawn. One 30-panel block is what makes the deal keep its array.
       */
      layoutBlocks: [
        {
          id: "b1",
          originE: 0,
          originN: 0,
          rotationDeg: 0,
          cols: 6,
          rows: 5,
          orientation: "portrait",
          omitted: [],
          azimuthDeg: 180,
          tiltDeg: 20,
        },
      ] as never,
      lenderId: cheapLender, year1ProductionKwh: 14_000, annualUsageKwh: 14_000,
    },
  });
  // Price it once, through the financing step, exactly as a rep would.
  await inSolar(() =>
    saveSolarFinanceAction({
      leadId, product: "loan", grossPpwCents: 350, dealerFeePct: 18,
    } as Parameters<typeof saveSolarFinanceAction>[0])
  );
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

  /** Redraw the array bigger — the way the designer actually changes a roof. */
  async function growTheRoof(cols: number) {
    await db.solarDesign.update({
      where: { leadId },
      data: {
        layoutBlocks: [
          {
            id: "b1", originE: 0, originN: 0, rotationDeg: 0,
            cols, rows: 5, orientation: "portrait", omitted: [],
            azimuthDeg: 180, tiltDeg: 20,
          },
        ] as never,
      },
    });
    // Any of the four paths into `recomputeDesignFigures` will do; the
    // equipment picker is the one a rep touches most.
    await inSolar(() => setSolarDesignEquipmentAction({ leadId, moduleId } as Parameters<
      typeof setSolarDesignEquipmentAction
    >[0]));
  }

describe("the contract follows every input that moves it", () => {
  it("is in step the moment the financing step is saved", async () => {
    const stored = await expectInStep();
    // 12 kW at $3.50/W, no adders, no battery.
    expect(stored).toBe(12_000 * 350);
  });

  it("follows an ADDER being added, and removed again", async () => {
    const before = await expectInStep();

    const added = await inSolar(() =>
      addDealAdderAction({
        leadId, label: "Trenching", basis: "flat", flatCents: 500_000, qty: 1,
        showOnProposal: false, financedOnTop: false,
      } as Parameters<typeof addDealAdderAction>[0])
    );
    expect(added.ok).toBe(true);
    const withAdder = await expectInStep();
    expect(withAdder).toBeGreaterThan(before);

    const row = await db.solarDealAdder.findFirstOrThrow({ where: { leadId } });
    expect((await inSolar(() => removeDealAdderAction({ leadId, id: row.id }))).ok).toBe(true);
    expect(await expectInStep()).toBe(before);
  });

  it("follows the ROOF being redrawn — more panels, bigger contract", async () => {
    const before = await expectInStep();
    const panelsBefore = (await design()).moduleQty;

    await growTheRoof(9); // 6 columns to 9, same five rows

    const after = await expectInStep();
    expect((await design()).moduleQty).toBeGreaterThan(panelsBefore);
    expect(after).toBeGreaterThan(before);
  });

  it("follows a BATTERY being added to the deal", async () => {
    const before = await expectInStep();
    const res = await inSolar(() =>
      setSolarDesignEquipmentAction({ leadId, batteryId, batteryQty: 2 } as Parameters<
        typeof setSolarDesignEquipmentAction
      >[0])
    );
    expect(res.ok).toBe(true);
    expect((await design()).batteryQty).toBe(2);

    /**
     * Two Powerwalls at the catalogue price ride on top at face value.
     *
     * Asserted as the DIFFERENCE from the array's own price rather than as an
     * absolute: `recomputeDesignFigures` owns the array size and re-derives it
     * from the drawn layout on the way through, so pinning a total here would
     * be pinning the layout maths as well as the money.
     */
    const after = await expectInStep();
    const f = await finance();
    const d = await design();
    expect(d.batteryQty).toBe(2);
    const arrayOnly = Math.round(d.systemSizeKwDc * 1000) * f.grossPpwCents;
    expect(after - arrayOnly).toBe(2 * 1_400_000);
    expect(before).toBeGreaterThan(0);
  });

  it("follows a change of LENDER", async () => {
    await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "loan", grossPpwCents: 350, dealerFeePct: 18,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    );
    await expectInStep();
    expect((await inSolar(() => setSolarDealLenderAction({ leadId, lenderId: dearLender }))).ok).toBe(true);
    expect((await design()).lenderId).toBe(dearLender);
    // The recompute ran on the way through and the cache is still in step.
    await expectInStep();
  });

  /**
   * THE ONE THING THE CACHE DELIBERATELY DOES NOT CARRY.
   *
   * A ceiling set on the LENDER ROW is applied where the deal is READ —
   * `priceStoredPurchase` — and written back only by generation. That is the
   * documented design: publishing a rate sheet must not silently rewrite every
   * saved deal on that partner. So the stored figure can legitimately sit above
   * the ceiling until a proposal is generated, and every screen still quotes
   * the capped number.
   *
   * Recorded here so a future reader does not "fix" the cache into carrying it
   * and re-price history in the process. A ceiling set on a lender PRODUCT is a
   * different thing and IS baked in at save, by `financeRowForProduct`.
   */
  it("does NOT bake a lender-row ceiling into the cache — that is applied on read", async () => {
    await db.solarLender.update({
      where: { id: dearLender },
      data: { maxFinalPpwCents: 500, finalPpwMode: "flat" },
    });
    await inSolar(() => setSolarDealLenderAction({ leadId, lenderId: dearLender }));

    const f = await finance();
    const d = await design();
    const watts = Math.round(d.systemSizeKwDc * 1000);
    // Stored: the uncapped sticker the rep typed.
    expect(f.grossPpwCents).toBe(350);
    // Read: the partner's own figure, applied by priceStoredPurchase.
    const onScreen = priceStoredPurchase({
      product: "loan",
      systemSizeKwDc: d.systemSizeKwDc,
      stickerPpwCents: f.grossPpwCents,
      dealerFeePct: f.dealerFeePct,
      adderTotalCents: f.adderTotalCents,
      onTopAdderTotalCents: f.onTopAdderTotalCents,
      batteryPriceCents: 0,
      maxFinalPpwCents: 500,
      finalPpwMode: "flat",
    }).breakdown.contractPriceCents;
    expect(onScreen).toBe(watts * 500);
    expect(onScreen).not.toBe(f.contractPriceCents);
  });
});

describe("a recompute never rewrites what a person typed", () => {
  it("leaves the base $/W, the APR, the term and the down payment alone", async () => {
    await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "loan", grossPpwCents: 412, dealerFeePct: 22,
        aprPct: 4.99, loanTermMonths: 300, downPaymentCents: 250_000,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    );
    const typed = await finance();

    // Something entirely unrelated to the financing step moves.
    await inSolar(() =>
      addDealAdderAction({
        leadId, label: "Conduit", basis: "flat", flatCents: 120_000, qty: 1,
        showOnProposal: false, financedOnTop: false,
      } as Parameters<typeof addDealAdderAction>[0])
    );

    const after = await finance();
    expect(after.grossPpwCents).toBe(typed.grossPpwCents);
    expect(after.dealerFeePct).toBe(typed.dealerFeePct);
    expect(after.aprPct).toBe(typed.aprPct);
    expect(after.loanTermMonths).toBe(typed.loanTermMonths);
    expect(after.downPaymentCents).toBe(typed.downPaymentCents);
    // …and the derived figure did move, which is the point.
    expect(after.contractPriceCents).not.toBe(typed.contractPriceCents);
    await expectInStep();
  });

  it("does nothing at all on a deal nobody has priced", async () => {
    // No finance row: there is no cache to keep in step, and creating one would
    // put a contract price on a deal that has never been quoted.
    await db.solarFinance.deleteMany({ where: { leadId } });
    await inSolar(() =>
      addDealAdderAction({
        leadId, label: "Nothing to price", basis: "flat", flatCents: 100_000, qty: 1,
        showOnProposal: false, financedOnTop: false,
      } as Parameters<typeof addDealAdderAction>[0])
    );
    expect(await db.solarFinance.count({ where: { leadId } })).toBe(0);
  });
});

describe("the figure a lender is asked to underwrite", () => {
  it("is the current contract, not the one from before the roof grew", async () => {
    // `lender-submit.ts` reads the STORED column — `contractPriceCents −
    // downPayment` — so this is the reader that made the cache load-bearing.
    await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "loan", grossPpwCents: 350, dealerFeePct: 18,
        downPaymentCents: 100_000,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    );
    const before = (await finance()).contractPriceCents;

    await growTheRoof(11);

    const f = await finance();
    expect(f.contractPriceCents).not.toBe(before);
    expect(f.contractPriceCents).toBe(await expectedContract());
    // The amount that would cross the wire, spelled out.
    expect(f.contractPriceCents - (f.downPaymentCents ?? 0)).toBe(
      (await expectedContract()) - 100_000
    );
  });
});
