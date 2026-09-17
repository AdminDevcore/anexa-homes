import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { verticalExtension } from "@/server/vertical/extension";
import type { SessionUser } from "@/server/auth/session";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { year1Production } from "@/lib/solar-money";
import { ASSUMPTIONS, DEALS, STORAGE_DEAL, optionFigures } from "@/lib/__tests__/pricing-golden-deals";

/**
 * GOLDEN: WHAT EVERY SERVER PRICING SITE WRITES TODAY.
 *
 * Pricing rework, Stage 0. The pure golden tests (lib/__tests__/pricing-golden.test.ts)
 * pin the functions; this pins what the server does with them against a real
 * database, for the same golden deals:
 *
 *  - the cached money columns (`recomputeDealMoney`, `dealMoneyColumns`)
 *  - generation: the frozen document and the row it writes back
 *  - `Lead.value`, `Project.contractValue` and the revenue report
 *  - payroll: the estimate and the commission line it writes
 *  - Amos's $2.00/W floor at the 65% fee its deals store
 *
 * The live re-price is not pinned here. It re-derives the system size from the
 * drawn roof layout before it prices, and this fixture has no drawing, so it
 * would pin a 0 kW deal. Stage 1 pins it, with the battery fix, in
 * pricing-stage1.itest.ts.
 *
 * Stage 1 moved these snapshots: every menu alternative is priced from the
 * deal's own base instead of the default sticker (L15), and the dealer fee is
 * off the customer's programme labels.
 *
 * Characterization, not specification. A figure changes only in the stage
 * approved to change it, and that commit updates the snapshot and says why.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

const { generateProposalVersion } = await import("../proposal-generate");
const { dealMoneyColumns, recomputeDealMoney } = await import("../deal-money");
const { restampLeadValue } = await import("../deal-value");
const { estimatedSolarCommission, computeSolarCommissionsForProject } = await import(
  "@/server/modules/payroll/solar-engine"
);
const { solarContractByLead } = await import("@/server/modules/reports/solar-contract");

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());
const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

type Key = "workedExample" | "cappedPartner" | "cash" | "storageOnly";

let companyId: string;
let user: SessionUser;
let repId: string;
let partnerLenderId: string;
const deals = {} as Record<Key, { leadId: string; projectId: string }>;

const MONEY_SELECT = {
  baseFinalPpwCents: true,
  baseFinalPerBatteryCents: true,
  dealerFeePct: true,
  addersInsideRuleCents: true,
  addersOutsideRuleCents: true,
  finalPriceCents: true,
  itcEstimateCents: true,
} as const;

const moneyRow = (leadId: string) =>
  raw.solarFinance.findUniqueOrThrow({ where: { leadId }, select: MONEY_SELECT });

const pickMoney = (cols: Record<string, unknown>) =>
  Object.fromEntries(Object.keys(MONEY_SELECT).filter((k) => k in cols).map((k) => [k, cols[k]]));

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  companyId = (
    await raw.company.create({
      data: {
        name: "Pricing Golden Co",
        slug: `golden-${stamp}`,
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
    data: { companyId, email: `golden-owner-${stamp}@example.com`, firstName: "Ola", lastName: "Owner", role: "super_admin" },
  });
  user = {
    userId: owner.id,
    companyId,
    role: "super_admin",
    fullName: "Ola Owner",
    permissions: {},
  } as unknown as SessionUser;
  requireUser.mockResolvedValue(user);

  repId = (
    await raw.user.create({
      data: {
        companyId,
        email: `golden-rep-${stamp}@example.com`,
        firstName: "Rhea",
        lastName: "Rep",
        role: "sales_rep",
        passwordHash: "x",
        solarRedlineCentsPerWatt: 200,
        solarPerWattMills: 150,
        solarBatteryPayPlan: "flat",
        solarPerBatteryFlatCents: 50_000,
      },
      select: { id: true },
    })
  ).id;

  const pipeline = await raw.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await raw.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });

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
  const module400 = await equipment({ kind: "module", model: "Q.PEAK-400", ratingW: 400 });
  const module440 = await equipment({ kind: "module", model: "Q.PEAK-440", ratingW: 440 });
  const batteryWorked = await equipment({ kind: "battery", model: "PW-15k", ratingW: 13_500, priceCents: 1_500_000 });
  const batteryPartner = await equipment({ kind: "battery", model: "PW-36k", ratingW: 13_500, priceCents: 3_600_000 });
  const batteryStorage = await equipment({ kind: "battery", model: "PW-10k", ratingW: 13_500, priceCents: 1_000_000 });

  const lender = (data: Record<string, unknown>) =>
    raw.solarLender.create({ data: { companyId, ...data } as never, select: { id: true } }).then((r) => r.id);
  const programme = (lenderId: string, data: Record<string, unknown>) =>
    raw.solarLenderProduct
      .create({ data: { companyId, lenderId, product: "loan", ...data } as never, select: { id: true } })
      .then((r) => r.id);

  const we = DEALS.workedExample;
  const cp = DEALS.cappedPartner;
  const cash = DEALS.cash;
  const st = STORAGE_DEAL;

  const workedLender = await lender({ name: "Example Lender", repPayMode: "redline" });
  const workedProgramme = await programme(workedLender, {
    name: null,
    aprPct: we.aprPct,
    termMonths: we.termMonths,
    dealerFeePct: we.feePct,
  });

  // Production's Amos shape, WITHOUT its $2.00/W floor: at the 65% the deals
  // store, that floor refuses generation. That refusal is pinned on its own below.
  partnerLenderId = await lender({
    name: cp.lenderName,
    repPayMode: "per_watt",
    priceRulePpwCents: cp.rule.maxFinalPpwCents,
    priceRuleMode: cp.rule.finalPpwMode,
    minBasePpwCents: null,
    signTodayMode: "above_cap",
    signTodayCapPpwCents: cp.signToday.capPpwCents,
    submissionAmountBasis: "after_credits",
  });
  const partnerProgramme = await programme(partnerLenderId, {
    name: cp.programmeName,
    aprPct: cp.aprPct,
    termMonths: cp.termMonths,
    dealerFeePct: cp.feePct,
    ppwBasis: cp.rule.ppwBasis,
  });

  const storageLender = await lender({
    name: st.lenderName,
    priceRulePerBatteryCents: st.maxFinalPricePerBatteryCents,
    priceRuleBatteryMode: st.finalBatteryPriceMode,
    signTodayMode: "above_cap",
    signTodayCapPpwCents: st.signToday.capPpwCents,
  });
  const storageProgramme = await programme(storageLender, {
    name: st.programmeName,
    aprPct: st.aprPct,
    termMonths: st.termMonths,
    dealerFeePct: st.feePct,
    batteryPriceBasis: st.batteryPriceBasis,
    financesStorageOnly: true,
  });

  async function seed(
    key: Key,
    design: Record<string, unknown>,
    finance: Record<string, unknown>,
    adders: { label: string; basis: "flat" | "perWatt"; flatCents?: number; millsPerWatt?: number; outsidePriceRule?: boolean }[],
    usageKwh: number,
    billCents: number
  ) {
    const lead = await raw.lead.create({
      data: {
        companyId,
        vertical: "solar",
        pipelineId: pipeline.id,
        stageId: stage.id,
        firstName: key,
        lastName: "Golden",
        email: `${key}-${stamp}@example.com`,
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
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `GOLD-${key}-${stamp}` },
      select: { id: true },
    });
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
        ...design,
      } as never,
    });
    for (const [i, a] of adders.entries()) {
      await raw.solarDealAdder.create({
        data: { companyId, leadId: lead.id, qty: 1, sortOrder: i, ...a },
      });
    }
    await raw.solarFinance.create({
      data: {
        companyId,
        leadId: lead.id,
        vertical: "solar",
        finalPriceCents: 0,
        // Every card ticked, so each menu is the one these snapshots pinned
        // before the menu followed the ticks: cash plus one programme from each
        // lender, every lender here publishing exactly one.
        shortlistIds: ["cash", workedProgramme, partnerProgramme, storageProgramme],
        ...finance,
      } as never,
    });
    deals[key] = { leadId: lead.id, projectId: project.id };
  }

  const production = (kw: number) => year1Production(kw, ASSUMPTIONS, null);

  await seed(
    "workedExample",
    {
      systemType: "pv_storage",
      moduleId: module400,
      moduleQty: 25,
      batteryId: batteryWorked,
      batteryQty: we.batteryQty,
      systemSizeKwDc: we.kw,
      year1ProductionKwh: production(we.kw),
      offsetPct: Math.round((production(we.kw) / we.usageKwh) * 100),
      lenderId: workedLender,
    },
    {
      product: "loan",
      lenderProductId: workedProgramme,
      baseFinalPpwCents: 400,
      dealerFeePct: we.feePct,
      aprPct: we.aprPct,
      loanTermMonths: we.termMonths,
    },
    [
      { label: "Main panel upgrade", basis: "flat", flatCents: 270_000 },
      { label: "Steep roof", basis: "perWatt", millsPerWatt: 100 },
    ],
    we.usageKwh,
    we.billCents
  );

  await seed(
    "cappedPartner",
    {
      systemType: "pv_storage",
      moduleId: module440,
      moduleQty: 29,
      batteryId: batteryPartner,
      batteryQty: cp.batteryQty,
      systemSizeKwDc: cp.kw,
      year1ProductionKwh: production(cp.kw),
      offsetPct: Math.round((production(cp.kw) / cp.usageKwh) * 100),
      lenderId: partnerLenderId,
    },
    {
      product: "loan",
      lenderProductId: partnerProgramme,
      baseFinalPpwCents: 551, // grossPpwFromNet(193, 65)
      dealerFeePct: cp.feePct,
      aprPct: cp.aprPct,
      loanTermMonths: cp.termMonths,
    },
    [{ label: "Re-roof", basis: "flat", flatCents: 700_000, outsidePriceRule: true }],
    cp.usageKwh,
    cp.billCents
  );

  await seed(
    "cash",
    {
      systemType: "pv",
      moduleId: module400,
      moduleQty: 20,
      systemSizeKwDc: cash.kw,
      year1ProductionKwh: production(cash.kw),
      offsetPct: Math.round((production(cash.kw) / cash.usageKwh) * 100),
      lenderId: null,
    },
    { product: "cash", baseFinalPpwCents: cash.basePpwCents, dealerFeePct: 0, signTodayCreditCents: cash.signTodayTypedCents },
    [{ label: "Critter guard", basis: "flat", flatCents: 150_000 }],
    cash.usageKwh,
    cash.billCents
  );

  await seed(
    "storageOnly",
    {
      systemType: "storage",
      batteryId: batteryStorage,
      batteryQty: st.batteryQty,
      systemSizeKwDc: 0,
      moduleQty: 0,
      year1ProductionKwh: 0,
      offsetPct: 0,
      lenderId: storageLender,
    },
    {
      product: "loan",
      lenderProductId: storageProgramme,
      baseFinalPpwCents: 0,
      baseFinalPerBatteryCents: 2_000_000, // grossPpwFromNet(1,000,000, 50)
      dealerFeePct: st.feePct,
      aprPct: st.aprPct,
      loanTermMonths: st.termMonths,
    },
    [],
    st.usageKwh,
    st.billCents
  );
});

afterAll(async () => {
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

const KEYS: Key[] = ["workedExample", "cappedPartner", "cash", "storageOnly"];

describe.each(KEYS)("golden server sites: %s", (key) => {
  it("derives the cached money columns (recomputeDealMoney, dealMoneyColumns)", async () => {
    const { leadId } = deals[key];
    const recompute = await inSolar(() => recomputeDealMoney(companyId, leadId));
    const row = await moneyRow(leadId);
    const f = await raw.solarFinance.findUniqueOrThrow({ where: { leadId } });
    const columns = await inSolar(() =>
      dealMoneyColumns(companyId, leadId, {
        product: f.product,
        grossPpwCents: f.baseFinalPpwCents,
        dealerFeePct: f.dealerFeePct,
        adderTotalCents: f.addersInsideRuleCents,
        onTopAdderTotalCents: f.addersOutsideRuleCents,
        aprPct: f.aprPct,
        loanTermMonths: f.loanTermMonths,
        lenderProductId: f.lenderProductId,
        stickerPricePerBatteryCents: f.baseFinalPerBatteryCents,
      })
    );
    expect({ recompute, rowAfterRecompute: row, columns: pickMoney(columns) }).toMatchSnapshot();
  });

  it("generates the document and stamps what reads it (generateProposalVersion, restampLeadValue, solarContractByLead)", async () => {
    const { leadId } = deals[key];
    const res = await inSolar(() => generateProposalVersion(user, leadId));
    if (!res.ok) {
      expect({ refused: { error: res.error, issues: (res.issues ?? []).map((i) => i.code) } }).toMatchSnapshot();
      return;
    }
    const snapshot = res.snapshot as SolarProposalSnapshot;
    const leadAfterGeneration = await raw.lead.findUniqueOrThrow({ where: { id: leadId }, select: { value: true } });
    await inSolar(() => restampLeadValue(companyId, leadId));
    const project = await raw.project.findUniqueOrThrow({
      where: { id: deals[key].projectId },
      select: { contractValue: true },
    });
    const revenue = await inSolar(() => solarContractByLead(companyId, [leadId]));
    expect({
      options: (snapshot.options ?? []).map(optionFigures),
      topLevel: {
        finalCents: snapshot.financing.finalPriceCents ?? null,
        netFinalCreditsAppliedCents: snapshot.financing.creditLadder?.netCostCents ?? null,
        financedCents: snapshot.financing.financedAmountCents ?? null,
      },
      rowAfterGeneration: await moneyRow(leadId),
      leadValueCents: leadAfterGeneration.value,
      projectContractValueCents: project.contractValue,
      revenueReportCents: revenue.get(leadId) ?? null,
    }).toMatchSnapshot();
  });

  it("estimates and pays the rep (estimatedSolarCommission, computeSolarCommissionsForProject)", async () => {
    const { leadId, projectId } = deals[key];
    const estimate = await inSolar(() => estimatedSolarCommission(db, companyId, leadId));
    await raw.commission.deleteMany({ where: { companyId, projectId } });
    const run = await inSolar(() =>
      computeSolarCommissionsForProject(db, companyId, { id: projectId, leadId, assignedRepId: repId, repName: "Rhea Rep" })
    );
    const line = await raw.commission.findFirst({
      where: { companyId, projectId, userId: repId, overrideId: null },
      select: { amount: true, baseAmount: true, solarGrossAmount: true, solarBasis: true, label: true },
    });
    expect({ estimate, created: run.created, refusals: run.refusals, line }).toMatchSnapshot();
  });
});

describe("golden server sites: the production floor on the capped partner", () => {
  it("records what generation does with Amos's $2.00/W floor at the stored 65% fee", async () => {
    const { leadId } = deals.cappedPartner;
    await raw.solarLender.update({ where: { id: partnerLenderId }, data: { minBasePpwCents: 200 } });
    try {
      const res = await inSolar(() => generateProposalVersion(user, leadId));
      expect(
        res.ok
          ? { ok: true }
          : { ok: false, error: res.error, issues: (res.issues ?? []).map((i) => i.code) }
      ).toMatchSnapshot();
    } finally {
      await raw.solarLender.update({ where: { id: partnerLenderId }, data: { minBasePpwCents: null } });
    }
  });
});
