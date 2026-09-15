import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { verticalExtension } from "@/server/vertical/extension";
import type { SessionUser } from "@/server/auth/session";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { pricePurchase, year1Production } from "@/lib/solar-money";
import { ASSUMPTIONS, DEALS, STORAGE_DEAL } from "@/lib/__tests__/pricing-golden-deals";

/**
 * PRICING REWORK, STAGE 1, against a real database.
 *
 *  - The live re-price keeps the battery (it now prices through
 *    `dealMoneyColumns`), including when the new version is refused.
 *  - The commission measure — watts, base price, battery count — is frozen at
 *    signing, checked against the signed version, and backfilled on rows
 *    signed before it existed.
 *  - Credits never change a commission, signed or not.
 *  - L16 pinned: a capped storage deal's stored per-battery sticker depends on
 *    which path wrote it last. Reported, not fixed.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

// No network. Every drawn plane falls to the market average, as it does when
// the lab does not answer.
vi.mock("../pvwatts", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../pvwatts")>()),
  resolvePlaneYields: vi.fn(async () => new Map()),
}));

const { repriceProposalAction } = await import("../proposal-reprice-actions");
const { generateProposalVersion } = await import("../proposal-generate");
const { recomputeDealMoney } = await import("../deal-money");
const { snapshotSolarDealComp } = await import("../deal-comp");
const { backfillCommissionMeasure, loadCommissionDeal } = await import("../commission-pricing");
const { estimatedSolarCommission, computeSolarCommissionsForProject } = await import(
  "@/server/modules/payroll/solar-engine"
);

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());
const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

const WE = DEALS.workedExample;
const ST = STORAGE_DEAL;
const REDLINE = 200;
/** The worked example's one battery, at catalogue. */
const WORKED_BATTERY_CENTS = 1_500_000;

/** Five by five 400 W panels, facing described so nothing asks a roof service. */
const LAYOUT = [
  {
    id: "b1",
    originE: 0,
    originN: 0,
    rotationDeg: 0,
    cols: 5,
    rows: 5,
    orientation: "portrait",
    omitted: [],
    azimuthDeg: 180,
    tiltDeg: 20,
  },
];

let companyId: string;
let user: SessionUser;
let repId: string;
let pipelineId: string;
let stageId: string;
let moduleId: string;
let batteryId: string;
let storageBatteryId: string;
let lenderId: string;
let programmeId: string;
let storageLenderId: string;
let storageProgrammeId: string;
const stamp = `${process.pid}-${Date.now()}`;

beforeAll(async () => {
  companyId = (
    await raw.company.create({
      data: {
        name: "Pricing Stage 1 Co",
        slug: `stage1-${stamp}`,
        phone: "(866) 650-9996",
        email: "support@example.com",
        address: "1 Test Way",
        city: "Dallas",
        state: "TX",
        zip: "75001",
      },
    })
  ).id;

  const owner = await raw.user.create({
    data: { companyId, email: `s1-owner-${stamp}@example.com`, firstName: "Ola", lastName: "Owner", role: "super_admin" },
  });
  user = { userId: owner.id, companyId, role: "super_admin", fullName: "Ola Owner", permissions: {} } as unknown as SessionUser;
  requireUser.mockResolvedValue(user);

  repId = (
    await raw.user.create({
      data: {
        companyId,
        email: `s1-rep-${stamp}@example.com`,
        firstName: "Rhea",
        lastName: "Rep",
        role: "sales_rep",
        passwordHash: "x",
        solarRedlineCentsPerWatt: REDLINE,
        solarPerWattMills: 150,
        solarBatteryPayPlan: "flat",
        solarPerBatteryFlatCents: 50_000,
      },
      select: { id: true },
    })
  ).id;

  pipelineId = (await raw.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } })).id;
  stageId = (
    await raw.pipelineStage.create({ data: { pipelineId, key: "new", name: "New", position: 1 } })
  ).id;

  const equipment = (data: { kind: "module" | "battery"; model: string; ratingW: number; priceCents?: number }) =>
    raw.solarEquipment
      .create({
        data: {
          companyId,
          manufacturer: data.kind === "module" ? "Qcells" : "Tesla",
          widthMm: data.kind === "module" ? 1134 : undefined,
          heightMm: data.kind === "module" ? 1879 : undefined,
          ...data,
          model: `${data.model}-${stamp}`,
        },
        select: { id: true },
      })
      .then((r) => r.id);
  moduleId = await equipment({ kind: "module", model: "Q.PEAK-400", ratingW: 400 });
  batteryId = await equipment({ kind: "battery", model: "PW-15k", ratingW: 13_500, priceCents: 1_500_000 });
  storageBatteryId = await equipment({ kind: "battery", model: "PW-10k", ratingW: 13_500, priceCents: 1_000_000 });

  lenderId = (
    await raw.solarLender.create({ data: { companyId, name: "Example Lender", repPayMode: "redline" } as never })
  ).id;
  programmeId = (
    await raw.solarLenderProduct.create({
      data: { companyId, lenderId, product: "loan", name: null, aprPct: WE.aprPct, termMonths: WE.termMonths, dealerFeePct: WE.feePct } as never,
    })
  ).id;

  storageLenderId = (
    await raw.solarLender.create({
      data: {
        companyId,
        name: ST.lenderName,
        maxFinalPricePerBatteryCents: ST.maxFinalPricePerBatteryCents,
        finalBatteryPriceMode: ST.finalBatteryPriceMode,
      } as never,
    })
  ).id;
  storageProgrammeId = (
    await raw.solarLenderProduct.create({
      data: {
        companyId,
        lenderId: storageLenderId,
        product: "loan",
        name: ST.programmeName,
        aprPct: ST.aprPct,
        termMonths: ST.termMonths,
        dealerFeePct: ST.feePct,
        batteryPriceBasis: ST.batteryPriceBasis,
        financesStorageOnly: true,
      } as never,
    })
  ).id;
});

afterAll(async () => {
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

/** The worked-example loan deal (10 kW, $3.00/W base at 25%, one $15,000 battery), or the golden storage deal. */
async function seedDeal(name: string, o: { layout?: boolean; storage?: boolean } = {}) {
  const lead = await raw.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId,
      stageId,
      firstName: name,
      lastName: "Stage1",
      email: `${name}-${stamp}@example.com`,
      phone: "5125550143",
      address: "18 Golden Row",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      lat: 32.78,
      lng: -96.8,
      assignedRepId: repId,
    },
    select: { id: true },
  });
  const project = await raw.project.create({
    data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `S1-${name}-${stamp}` },
    select: { id: true },
  });
  const usageKwh = o.storage ? ST.usageKwh : WE.usageKwh;
  const billCents = o.storage ? ST.billCents : WE.billCents;
  const production = year1Production(WE.kw, ASSUMPTIONS, null);
  await raw.solarDesign.create({
    data: {
      companyId,
      leadId: lead.id,
      vertical: "solar",
      annualUsageKwh: usageKwh,
      avgMonthlyBillCents: billCents,
      utilityRateMills: Math.round(((billCents * 12) / usageKwh) * 10),
      utilityProvider: "Oncor",
      layoutImageFileId: "00000000-0000-0000-0000-000000000001",
      batteryQtySetByRep: true,
      ...(o.storage
        ? {
            systemType: "storage",
            batteryId: storageBatteryId,
            batteryQty: ST.batteryQty,
            systemSizeKwDc: 0,
            moduleQty: 0,
            year1ProductionKwh: 0,
            offsetPct: 0,
            lenderId: storageLenderId,
          }
        : {
            systemType: "pv_storage",
            moduleId,
            moduleQty: 25,
            batteryId,
            batteryQty: WE.batteryQty,
            systemSizeKwDc: WE.kw,
            year1ProductionKwh: production,
            offsetPct: Math.round((production / usageKwh) * 100),
            lenderId,
            layoutBlocks: o.layout ? LAYOUT : [],
          }),
    } as never,
  });
  if (!o.storage) {
    await raw.solarDealAdder.create({ data: { companyId, leadId: lead.id, qty: 1, sortOrder: 0, label: "Main panel upgrade", basis: "flat", flatCents: 270_000 } });
    await raw.solarDealAdder.create({ data: { companyId, leadId: lead.id, qty: 1, sortOrder: 1, label: "Steep roof", basis: "perWatt", millsPerWatt: 100 } });
  }
  await raw.solarFinance.create({
    data: {
      companyId,
      leadId: lead.id,
      vertical: "solar",
      product: "loan",
      contractPriceCents: 0,
      ...(o.storage
        ? {
            lenderProductId: storageProgrammeId,
            grossPpwCents: 0,
            stickerPricePerBatteryCents: 2_000_000, // grossPpwFromNet(1,000,000, 50)
            dealerFeePct: ST.feePct,
            aprPct: ST.aprPct,
            loanTermMonths: ST.termMonths,
          }
        : {
            lenderProductId: programmeId,
            grossPpwCents: 400, // grossPpwFromNet(300, 25)
            dealerFeePct: WE.feePct,
            aprPct: WE.aprPct,
            loanTermMonths: WE.termMonths,
          }),
    } as never,
  });
  // Every adder and the contract in step before anything is asked of the deal.
  await inSolar(() => recomputeDealMoney(companyId, lead.id));
  return { leadId: lead.id, projectId: project.id };
}

async function generate(leadId: string) {
  const res = await inSolar(() => generateProposalVersion(user, leadId));
  if (!res.ok) throw new Error(`generation refused: ${res.error} ${(res.issues ?? []).map((i) => i.code).join(", ")}`);
  const row = await raw.solarProposal.findFirstOrThrow({ where: { leadId }, orderBy: { version: "desc" } });
  return { row, snapshot: res.snapshot as SolarProposalSnapshot };
}

async function sign(leadId: string, proposalId: string) {
  const signedAt = new Date();
  await raw.solarProposal.update({ where: { id: proposalId }, data: { status: "signed", signedAt } });
  await inSolar(() => snapshotSolarDealComp({ companyId, leadId, signedAt, proposalId }));
  return signedAt;
}

const money = (leadId: string) =>
  raw.solarFinance.findUniqueOrThrow({
    where: { leadId },
    select: { grossPpwCents: true, stickerPricePerBatteryCents: true, adderTotalCents: true, onTopAdderTotalCents: true, contractPriceCents: true },
  });

/** The final price of the per-watt loan deal as stored, with or without its battery. */
async function perWattFinal(leadId: string, batteryPriceCents: number) {
  const [row, design] = await Promise.all([
    money(leadId),
    raw.solarDesign.findUniqueOrThrow({ where: { leadId }, select: { systemSizeKwDc: true } }),
  ]);
  return pricePurchase({
    product: "loan",
    systemSizeKwDc: design.systemSizeKwDc,
    stickerPpwCents: row.grossPpwCents,
    dealerFeePct: WE.feePct,
    adderTotalCents: row.adderTotalCents,
    onTopAdderTotalCents: row.onTopAdderTotalCents,
    batteryPriceCents,
  }).contractPriceCents;
}

/** What the rep is shown and what payroll writes, for one deal. */
async function pay(leadId: string, projectId: string) {
  const estimate = await inSolar(() => estimatedSolarCommission(db, companyId, leadId));
  await raw.commission.deleteMany({ where: { companyId, projectId } });
  const run = await inSolar(() =>
    computeSolarCommissionsForProject(db, companyId, { id: projectId, leadId, assignedRepId: repId, repName: "Rhea Rep" })
  );
  const line = await raw.commission.findFirst({
    where: { companyId, projectId, userId: repId, overrideId: null },
    select: { amount: true, baseAmount: true, solarBasis: true, label: true },
  });
  return { estimate, refusals: run.refusals, line };
}

describe("the live re-price keeps the battery (site 2)", () => {
  it("re-prices a drawn deal with its battery on the contract", async () => {
    const { leadId } = await seedDeal("reprice-ok", { layout: true });
    const { row: v1 } = await generate(leadId);

    const res = await inSolar(() => repriceProposalAction({ proposalId: v1.id, grossPpwCents: 420 }));
    expect(res.ok).toBe(true);

    const design = await raw.solarDesign.findUniqueOrThrow({ where: { leadId }, select: { systemSizeKwDc: true } });
    expect(design.systemSizeKwDc).toBe(10); // 25 × 400 W, re-derived from the drawing
    const row = await money(leadId);
    expect(row.grossPpwCents).toBe(420);
    expect(row.contractPriceCents).toBe(await perWattFinal(leadId, WORKED_BATTERY_CENTS));
    expect(row.contractPriceCents).toBeGreaterThan(await perWattFinal(leadId, 0));
  });

  it("leaves the battery on the deal when the new version is refused", async () => {
    const { leadId } = await seedDeal("reprice-refused", { layout: true });
    const { row: v1 } = await generate(leadId);

    // A maximum offset this deal cannot meet: the deal is re-priced, the document refused.
    await raw.solarSettings.upsert({
      where: { companyId },
      create: { companyId, maxOffsetPct: 10 },
      update: { maxOffsetPct: 10 },
    });
    try {
      const res = await inSolar(() => repriceProposalAction({ proposalId: v1.id, grossPpwCents: 420 }));
      expect(res).toMatchObject({ ok: false, dealUpdated: true });
      expect(res.ok === false && res.issues?.map((i) => i.code)).toContain("design.offset_above_max");

      // The row the re-price wrote, untouched by any generation. It used to
      // carry no battery here.
      const row = await money(leadId);
      expect(row.grossPpwCents).toBe(420);
      expect(row.contractPriceCents).toBe(await perWattFinal(leadId, WORKED_BATTERY_CENTS));
    } finally {
      await raw.solarSettings.deleteMany({ where: { companyId } });
    }
  });

  it("prices a storage-only deal per battery, even when the new version is refused", async () => {
    const { leadId } = await seedDeal("reprice-storage", { storage: true });
    const { row: v1 } = await generate(leadId);

    // Paper that does not fund storage refuses the document, not the re-price.
    await raw.solarLenderProduct.update({ where: { id: storageProgrammeId }, data: { financesStorageOnly: false } });
    try {
      const res = await inSolar(() => repriceProposalAction({ proposalId: v1.id, lenderProductId: storageProgrammeId }));
      expect(res).toMatchObject({ ok: false, dealUpdated: true });
      expect(res.ok === false && res.issues?.map((i) => i.code)).toContain("storage.product_not_eligible");
      // Two batteries at the partner's flat $12,000 gross, grossed up by the 50% fee.
      // The old re-price priced this per watt, over zero watts: a $0 contract.
      expect(await money(leadId)).toMatchObject({ grossPpwCents: 0, contractPriceCents: 4_800_000 });
    } finally {
      await raw.solarLenderProduct.update({ where: { id: storageProgrammeId }, data: { financesStorageOnly: true } });
    }
  });

  it("asks a storage deal's per-battery floor before writing, not the per-watt one", async () => {
    const { leadId } = await seedDeal("reprice-storage-floor", { storage: true });
    const { row: v1 } = await generate(leadId);
    const before = await money(leadId);

    await raw.solarLender.update({
      where: { id: storageLenderId },
      data: { minBasePpwCents: 200, minBasePricePerBatteryCents: 1_300_000 },
    });
    try {
      const res = await inSolar(() => repriceProposalAction({ proposalId: v1.id, lenderProductId: storageProgrammeId }));
      expect(res).toEqual({ ok: false, error: "That price leaves less per battery than this lender allows." });
      expect(await money(leadId)).toEqual(before);
    } finally {
      await raw.solarLender.update({
        where: { id: storageLenderId },
        data: { minBasePpwCents: null, minBasePricePerBatteryCents: null },
      });
    }
  });
});

describe("the commission measure is frozen at signing", () => {
  it("freezes watts, base price and batteries, checked against the signed version", async () => {
    const { leadId, projectId } = await seedDeal("sign");
    const { row: v1 } = await generate(leadId);
    const unsigned = await pay(leadId, projectId);
    await sign(leadId, v1.id);

    const live = await inSolar(() => loadCommissionDeal(db, companyId, leadId));
    const comp = await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } });
    expect(comp).toMatchObject({
      basis: "redline",
      redlineCentsPerWatt: REDLINE,
      systemWatts: 10_000,
      basePriceCents: live!.basePriceCents,
      batteryQty: 1,
      pricedFrom: "signature",
      pricedProposalId: v1.id,
      pricingMatchesSignedDocument: true,
    });
    // Freezing the live figure moves nothing on the day. Only the estimate's
    // provenance changes: its terms now come from the signing.
    const before = await pay(leadId, projectId);
    expect(before.estimate).toMatchObject({ fromSnapshot: true });
    expect({ ...before, estimate: { ...before.estimate, fromSnapshot: false } }).toEqual(unsigned);

    // After signing, the live deal can move and the commission does not.
    await raw.solarFinance.update({ where: { leadId }, data: { grossPpwCents: 600 } });
    await raw.solarDesign.update({ where: { leadId }, data: { systemSizeKwDc: 12 } });
    expect(await pay(leadId, projectId)).toEqual(before);

    // A later signature re-freezes the measure and keeps the first signature's rates.
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 250 } });
    try {
      const moved = await inSolar(() => loadCommissionDeal(db, companyId, leadId));
      const rest = Object.fromEntries(
        Object.entries(v1).filter(([k]) => !["id", "createdAt", "updatedAt"].includes(k))
      );
      const snapshot = v1.snapshot as SolarProposalSnapshot;
      const v2 = await raw.solarProposal.create({
        data: {
          ...rest,
          version: 2,
          publicToken: null,
          signedAt: null,
          status: "generated",
          snapshot: {
            ...snapshot,
            system: { ...snapshot.system, sizeKwDc: 12 },
            financing: { ...snapshot.financing, contractPriceCents: moved!.finalPriceCents },
          },
        } as never,
      });
      await sign(leadId, v2.id);
      const refrozen = await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } });
      expect(refrozen).toMatchObject({
        redlineCentsPerWatt: REDLINE,
        systemWatts: 12_000,
        basePriceCents: moved!.basePriceCents,
        pricedProposalId: v2.id,
        pricingMatchesSignedDocument: true,
      });
      const after = await pay(leadId, projectId);
      expect(after.line?.amount).not.toBe(before.line?.amount);
      expect(after.line?.amount).toBe(moved!.basePriceCents - REDLINE * 12_000);
    } finally {
      await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE } });
    }
  });

  it("keeps reading the live deal until the customer signs", async () => {
    const { leadId, projectId } = await seedDeal("unsigned");
    await generate(leadId);
    const before = await pay(leadId, projectId);
    await raw.solarFinance.update({ where: { leadId }, data: { grossPpwCents: 600 } });
    expect((await pay(leadId, projectId)).line?.amount).not.toBe(before.line?.amount);
  });

  it("flags a signature on a version the deal no longer prices to, and still freezes", async () => {
    const { leadId } = await seedDeal("mismatch");
    const { row: v1 } = await generate(leadId);
    await raw.solarFinance.update({ where: { leadId }, data: { grossPpwCents: 450 } });
    await sign(leadId, v1.id);

    const comp = await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } });
    expect(comp.pricedFrom).toBe("signature");
    expect(comp.pricingMatchesSignedDocument).toBe(false);
    const log = await raw.activityLog.findFirst({
      where: { companyId, leadId, message: { contains: "does not match signed proposal v1" } },
      select: { message: true },
    });
    expect(log?.message).toContain("final price");
  });
});

describe("the backfill freezes rows signed before the measure existed", () => {
  it("reports, then writes the live measure, and moves no commission", async () => {
    const { leadId, projectId } = await seedDeal("backfill");
    const { row: v1 } = await generate(leadId);
    const signedAt = new Date();
    await raw.solarProposal.update({ where: { id: v1.id }, data: { status: "signed", signedAt } });
    // A row as the old signature wrote it: the rates and nothing else.
    await raw.solarDealComp.create({
      data: { companyId, leadId, repId, basis: "redline", redlineCentsPerWatt: REDLINE, signedAt },
    });
    const before = await pay(leadId, projectId);

    const dry = await inSolar(() => backfillCommissionMeasure(db, { apply: false, now: new Date(), companyId }));
    expect(dry.map((r) => r.leadId)).toEqual([leadId]);
    expect(dry[0].outcome).toMatchObject({
      status: "would_freeze",
      matches: true,
      proposalId: v1.id,
      measure: { systemWatts: 10_000, batteryQty: 1 },
    });
    expect((await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } })).pricedAt).toBeNull();

    const applied = await inSolar(() => backfillCommissionMeasure(db, { apply: true, now: new Date(), companyId }));
    expect(applied[0].outcome.status).toBe("frozen");
    expect(await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } })).toMatchObject({
      pricedFrom: "backfill",
      pricedProposalId: v1.id,
      pricingMatchesSignedDocument: true,
    });
    expect(await pay(leadId, projectId)).toEqual(before);

    // Nothing left to do on a second run.
    expect(await inSolar(() => backfillCommissionMeasure(db, { apply: true, now: new Date(), companyId }))).toEqual([]);
  });
});

describe("credits never change a commission", () => {
  const SCENARIOS = [
    { claimItc: false, claimEnergyCommunity: false, claimDomesticContent: false, signTodayCreditCents: 0 },
    { claimItc: true, claimEnergyCommunity: false, claimDomesticContent: false, signTodayCreditCents: 0 },
    { claimItc: true, claimEnergyCommunity: true, claimDomesticContent: true, signTodayCreditCents: 250_000 },
  ];

  it("unsigned: every credit state prices a different document and the same commission", async () => {
    const { leadId, projectId } = await seedDeal("credits");
    await generate(leadId);
    const base = await pay(leadId, projectId);
    expect(base.line?.amount).toBeGreaterThan(0);

    const nets: (number | null)[] = [];
    await raw.solarLender.update({ where: { id: lenderId }, data: { signTodayMode: "none" } });
    for (const scenario of SCENARIOS) {
      await raw.solarFinance.update({ where: { leadId }, data: scenario });
      const { snapshot } = await generate(leadId);
      nets.push(snapshot.financing.creditLadder?.netCostCents ?? null);
      expect(await pay(leadId, projectId)).toEqual(base);
    }

    // A partner's own sign-today rule, measured over its cap.
    await raw.solarLender.update({ where: { id: lenderId }, data: { signTodayMode: "above_cap", signTodayCapPpwCents: 250 } });
    try {
      const { snapshot } = await generate(leadId);
      nets.push(snapshot.financing.creditLadder?.netCostCents ?? null);
      expect(await pay(leadId, projectId)).toEqual(base);
    } finally {
      await raw.solarLender.update({ where: { id: lenderId }, data: { signTodayMode: "none", signTodayCapPpwCents: null } });
    }

    // The test is only worth something if the credits really moved the document.
    expect(new Set(nets).size).toBeGreaterThan(2);
  });

  it("signed: taking every credit off leaves the frozen commission alone", async () => {
    const { leadId, projectId } = await seedDeal("credits-signed");
    await raw.solarFinance.update({ where: { leadId }, data: SCENARIOS[2] });
    const { row } = await generate(leadId);
    await sign(leadId, row.id);
    const signed = await pay(leadId, projectId);

    await raw.solarFinance.update({ where: { leadId }, data: SCENARIOS[0] });
    expect(await pay(leadId, projectId)).toEqual(signed);
  });
});

describe("L16 pinned: a capped storage deal's stored per-battery sticker depends on the last writer", () => {
  it("stores the typed sticker on save, the capped one on generation, and keeps the capped one after", async () => {
    const { leadId } = await seedDeal("l16", { storage: true }); // saved: recomputeDealMoney ran
    const afterSave = await money(leadId);
    await generate(leadId);
    const afterGeneration = await money(leadId);
    await inSolar(() => recomputeDealMoney(companyId, leadId));
    const afterNextSave = await money(leadId);

    expect(
      [afterSave, afterGeneration, afterNextSave].map((r) => [r.stickerPricePerBatteryCents, r.contractPriceCents])
    ).toEqual([
      [2_000_000, 4_800_000], // what was typed: $10,000 base at 50%
      [2_400_000, 4_800_000], // the partner's flat $12,000 gross at 50%, written back by generation
      [2_400_000, 4_800_000], // the capped figure is now the "typed" input
    ]);
  });
});
