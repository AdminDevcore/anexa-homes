import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { verticalExtension } from "@/server/vertical/extension";

/**
 * THE DEAL PAGE AND PAYROLL MUST AGREE.
 *
 * `estimatedSolarCommission` shows a rep what this deal is currently worth to
 * them. `computeSolarCommissionsForProject` decides what they are actually
 * paid. The two carried SEPARATE copies of the precedence chain, and the copies
 * disagreed on the case that matters most: a signed deal with no frozen terms.
 * Payroll refused it — correctly, because repricing a closed sale against
 * today's redline invents a number nobody agreed to — while the deal page fell
 * through to the rep's current profile and showed a confident figure payroll
 * would never pay.
 *
 * They now share `resolveDealPayTerms`. Every case below asserts the two
 * answers are the same answer, rather than asserting each separately against a
 * figure I chose.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const { estimatedSolarCommission, computeSolarCommissionsForProject } =
  await import("../solar-engine");
/**
 * The deal's price, re-derived after the design moves.
 *
 * Production never edits a design and leaves the contract behind — that was
 * P1-6, and `recomputeDealMoney` is the fix. A battery test that skipped it
 * would be asserting against a contract the battery never reached, which is
 * how the first draft of these two cases "passed" at the wrong figure.
 */
const { recomputeDealMoney } = await import("@/server/modules/solar/deal-money");

/**
 * The EXTENDED client, as the engine receives one in production.
 *
 * `Db` is the vertical-scoped client, and the functions under test are what has
 * to survive that extension — handing them a plain client would test a code
 * path production never uses. `raw` stays for fixtures, which are built outside
 * any workspace. The same split `solar-pay.itest.ts` uses.
 */
const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;
let leadId: string;
let projectId: string;
let repId: string;
let lenderId: string;

const REDLINE = 200; // $2.00/W
const SYSTEM_KW = 12;
const PPW = 350; // $3.50/W sticker
const FEE = 18;

const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

const estimate = () => inSolar(() => estimatedSolarCommission(db, companyId, leadId));

async function runPayroll() {
  await raw.commission.deleteMany({ where: { companyId } });
  return inSolar(() =>
    computeSolarCommissionsForProject(db, companyId, {
      id: projectId,
      leadId,
      assignedRepId: repId,
      repName: "Rhea Rep",
    })
  );
}

/** What payroll actually wrote for the rep, or null if it wrote nothing. */
async function payrollLine() {
  return raw.commission.findFirst({
    where: { companyId, projectId, userId: repId, overrideId: null },
    select: { amount: true, solarGrossAmount: true, solarBasis: true },
  });
}

async function sign() {
  await raw.solarProposal.updateMany({
    where: { leadId },
    data: { status: "signed", signedAt: new Date() },
  });
}

beforeAll(async () => {
  const company = await raw.company.create({
    data: { name: "Agree Co", slug: `agree-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const rep = await raw.user.create({
    data: {
      companyId, email: `rep-agree-${process.pid}@test.local`,
      firstName: "Rhea", lastName: "Rep", role: "sales_rep", passwordHash: "x",
      solarRedlineCentsPerWatt: REDLINE,
    },
    select: { id: true },
  });
  repId = rep.id;

  lenderId = (await raw.solarLender.create({
    data: { companyId, name: "Agree Bank", repPayMode: "redline" },
    select: { id: true },
  })).id;

  const pipeline = await raw.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await raw.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "m1", name: "M1 Funding", position: 10 },
  });
  const lead = await raw.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Agree", lastName: "Deal", assignedRepId: repId,
    },
  });
  leadId = lead.id;
  projectId = (await raw.project.create({
    data: { companyId, vertical: "solar", leadId, projectNumber: `AG-${Date.now()}` },
    select: { id: true },
  })).id;
});

beforeEach(async () => {
  await raw.commission.deleteMany({ where: { companyId } });
  await raw.solarDealComp.deleteMany({ where: { leadId } });
  await raw.solarProposal.deleteMany({ where: { leadId } });
  await raw.solarFinance.deleteMany({ where: { leadId } });
  await raw.solarDesign.deleteMany({ where: { leadId } });

  await raw.solarDesign.create({
    data: {
      companyId, leadId, vertical: "solar", systemType: "pv",
      systemSizeKwDc: SYSTEM_KW, moduleQty: 30, lenderId,
      year1ProductionKwh: 14_000, annualUsageKwh: 14_000,
    },
  });
  await raw.solarFinance.create({
    data: {
      companyId, leadId, vertical: "solar", product: "loan",
      grossPpwCents: PPW, dealerFeePct: FEE,
      contractPriceCents: SYSTEM_KW * 1000 * PPW,
    },
  });
  await raw.solarProposal.create({
    data: { companyId, leadId, version: 1, status: "generated", snapshot: { schemaVersion: 7 } as never },
  });
  await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE } });
});

afterAll(async () => {
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

describe("an UNSIGNED deal quotes the rep's current terms", () => {
  it("and payroll would pay exactly that", async () => {
    const est = await estimate();
    expect(est.state).toBe("estimate");

    await runPayroll();
    const line = await payrollLine();
    expect(line).not.toBeNull();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(est.state === "estimate" && est.grossCents).toBe(line!.solarGrossAmount);
    expect(est.state === "estimate" && est.basis).toBe(line!.solarBasis);
  });

  it("says the figure did NOT come from a snapshot", async () => {
    const est = await estimate();
    expect(est.state === "estimate" && est.fromSnapshot).toBe(false);
  });
});

describe("a SIGNED deal quotes the terms it was sold on", () => {
  beforeEach(async () => {
    await sign();
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "redline", redlineCentsPerWatt: REDLINE, signedAt: new Date(),
      },
    });
  });

  it("and payroll pays the same", async () => {
    const est = await estimate();
    await runPayroll();
    const line = await payrollLine();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
  });

  it("IGNORES a redline raised after the signature — both of them", async () => {
    // The whole point of freezing terms: a rep whose profile is bumped must not
    // see, or be paid, a different number on a deal that already closed.
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 50 } });

    const est = await estimate();
    await runPayroll();
    const line = await payrollLine();

    expect(est.state === "estimate" && est.fromSnapshot).toBe(true);
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    // Against the redline it was SOLD at, not the new one.
    const base = SYSTEM_KW * 1000 * PPW - Math.round(SYSTEM_KW * 1000 * PPW * (FEE / 100));
    expect(line!.amount).toBe(base - REDLINE * SYSTEM_KW * 1000);
  });
});

describe("THE CASE THE TWO USED TO DISAGREE ON", () => {
  it("a signed deal with NO frozen terms is refused by both, not estimated by one", async () => {
    // Signed, and `SolarDealComp` never written — the state left behind when
    // `snapshotSolarDealComp` throws. Payroll always refused this. The deal
    // page used to fall through to the rep's profile and quote a number.
    await sign();
    expect(await raw.solarDealComp.count({ where: { leadId } })).toBe(0);

    const est = await estimate();
    expect(est.state).toBe("unavailable");
    expect(est.state === "unavailable" && est.reason).toMatch(/signed without usable compensation/i);

    const { created, refusals } = await runPayroll();
    expect(created).toBe(0);
    expect(await payrollLine()).toBeNull();
    expect(refusals[0]?.reason).toMatch(/signed without usable compensation/i);

    // The two now give the SAME reason, not merely the same verdict.
    expect(est.state === "unavailable" && est.reason).toBe(refusals[0]?.reason);
  });

  it("a deal flagged for review is blocked on both sides", async () => {
    await sign();
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "unresolved", signedAt: new Date(), needsReview: true,
      },
    });

    const est = await estimate();
    expect(est.state).toBe("needs_review");

    const { created } = await runPayroll();
    expect(created).toBe(0);
    expect(await payrollLine()).toBeNull();
  });

  it("reads the terms off an EXISTING commission line when that is all there is", async () => {
    // Layer 2 of the chain. A deal whose line was written before
    // `SolarDealComp` existed carries its terms there and nowhere else; the
    // estimate never looked, so it showed a different number from the one
    // already generated against the rep's name.
    await sign();
    await raw.commission.create({
      data: {
        companyId, projectId, userId: repId, status: "pending",
        label: "Solar redline ($1.00/W over $2.50/W · 12,000 W)",
        vertical: "solar",
        solarBasis: "redline",
        solarRedlineCentsPerWatt: 250,
        amount: 1, baseAmount: 1,
      },
    });

    const est = await estimate();
    expect(est.state).toBe("estimate");
    const base = SYSTEM_KW * 1000 * PPW - Math.round(SYSTEM_KW * 1000 * PPW * (FEE / 100));
    // Priced against the line's own $2.50/W, not the profile's $2.00/W.
    expect(est.state === "estimate" && est.grossCents).toBe(base - 250 * SYSTEM_KW * 1000);

    // And payroll, re-running over the same line, agrees.
    const updated = await inSolar(() =>
      computeSolarCommissionsForProject(db, companyId, {
        id: projectId, leadId, assignedRepId: repId, repName: "Rhea Rep",
      })
    );
    expect(updated.refusals).toEqual([]);
    const line = await payrollLine();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
  });
});

describe("the company's lead take is applied identically", () => {
  it("both sides take 40% once M1 has classified the lead", async () => {
    await sign();
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "redline", redlineCentsPerWatt: REDLINE, signedAt: new Date(),
        companyProvidedLead: true, leadAdjustMode: "percentage", companyLeadTakePct: 40,
      },
    });

    const est = await estimate();
    await runPayroll();
    const line = await payrollLine();

    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(est.state === "estimate" && est.grossCents).toBe(line!.solarGrossAmount);
    // 40% kept by the company, so the rep nets 60% of what the basis produced.
    expect(line!.amount).toBe(Math.round(line!.solarGrossAmount! * 0.6));
  });
});

/**
 * THE REST OF THE COMPENSATION MATRIX.
 *
 * The cases above cover redline. A rep can also be paid a flat rate per watt,
 * a battery can be paid on separately from the array, and the company's share
 * of a lead it supplied comes off the top. Every one of those is a separate
 * branch of `resolveDealPayTerms`, and the whole point of extracting it was
 * that the deal page and payroll walk the SAME branch.
 *
 * So none of these assert a figure I chose. Each asserts the two answers agree,
 * and then names the one property that makes the case distinctive — that flat
 * ignores the redline entirely, that a battery adds on top of the array, that
 * the company's take comes off the gross.
 */

/** Put the deal on a lender paying the given way, and re-read the design. */
async function lenderPaying(
  mode: "redline" | "per_watt",
  batteryMode?: "redline" | "flat"
) {
  await raw.solarLender.update({
    where: { id: lenderId },
    data: { repPayMode: mode, ...(batteryMode ? { batteryPayMode: batteryMode } : {}) },
  });
}

/** Both sides, for the deal as it currently stands. */
async function bothAgree() {
  const est = await estimate();
  await runPayroll();
  const line = await payrollLine();
  return { est, line };
}

describe("a FLAT per-watt rep", () => {
  beforeEach(async () => {
    await lenderPaying("per_watt");
    await raw.user.update({
      where: { id: repId },
      // 15 mills = $0.15 a watt, and a redline that must be ignored.
      data: { solarPerWattMills: 15, solarRedlineCentsPerWatt: REDLINE },
    });
  });

  it("is paid the same by both, on an unsigned deal", async () => {
    const { est, line } = await bothAgree();
    expect(line).not.toBeNull();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(est.state === "estimate" && est.basis).toBe(line!.solarBasis);
  });

  it("does NOT quote the redline — the lender decides the mode, not the profile", async () => {
    const { est, line } = await bothAgree();
    // The redline answer for this deal is a different, larger number; if either
    // side had reached for it the two would still agree but both be wrong, so
    // this pins the mode rather than only the agreement.
    const redlineAnswer =
      SYSTEM_KW * 1000 * PPW -
      Math.round(SYSTEM_KW * 1000 * PPW * (FEE / 100)) -
      REDLINE * SYSTEM_KW * 1000;
    expect(line!.amount).not.toBe(redlineAnswer);
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    // $0.15 x 12,000 W.
    expect(line!.solarGrossAmount).toBe(Math.round((15 / 1000) * 100 * SYSTEM_KW * 1000));
  });

  it("keeps the flat rate it was SIGNED at when the profile moves", async () => {
    await sign();
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "per_watt", millsPerWatt: 15, signedAt: new Date(),
      },
    });
    await raw.user.update({ where: { id: repId }, data: { solarPerWattMills: 99 } });

    const { est, line } = await bothAgree();
    expect(est.state === "estimate" && est.fromSnapshot).toBe(true);
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(line!.solarGrossAmount).toBe(Math.round((15 / 1000) * 100 * SYSTEM_KW * 1000));
  });
});

describe("BATTERIES, priced beside the array", () => {
  beforeEach(async () => {
    await raw.solarDesign.update({
      where: { leadId },
      data: { systemType: "pv_storage", batteryQty: 2 },
    });
    await raw.solarFinance.update({
      where: { leadId },
      data: { stickerPricePerBatteryCents: 1_200_000 },
    });
    await inSolar(() => recomputeDealMoney(companyId, leadId));
  });

  it("SOLAR + BATTERY: the battery does NOT move the array's pay, and both sides say so", async () => {
    await lenderPaying("redline", "redline");
    await raw.user.update({
      where: { id: repId },
      data: { solarRedlineCentsPerWatt: REDLINE, solarRedlinePerBatteryCents: 900_000 },
    });

    const withBatteries = await bothAgree();
    expect(withBatteries.est.state === "estimate" && withBatteries.est.netCents)
      .toBe(withBatteries.line!.amount);

    /**
     * And it is the SAME figure with the batteries taken off.
     *
     * This is the documented rule, not an oversight — `solar-pay.ts` sends `pv`
     * and `pv_storage` down one path, and a redline is measured on
     * `basePriceCents`, which the battery is deliberately priced outside of.
     * The battery reaches the CONTRACT (recomputeDealMoney above puts it there)
     * without reaching the array's commission.
     *
     * Asserted rather than assumed because my first draft of this test expected
     * the opposite, and a test that merely checked the two sides agree would
     * have passed either way.
     */
    await raw.solarDesign.update({
      where: { leadId },
      data: { systemType: "pv", batteryQty: 0 },
    });
    await inSolar(() => recomputeDealMoney(companyId, leadId));
    const without = await bothAgree();
    expect(without.est.state === "estimate" && without.est.netCents).toBe(without.line!.amount);
    expect(withBatteries.line!.solarGrossAmount).toBe(without.line!.solarGrossAmount);
  });

  it("BATTERY-ONLY (storage): the REP's own battery plan pays, and both agree", async () => {
    // Storage prices at zero per watt, which is how battery-only deals once
    // paid a rep nothing at all. The plan read here is the REP's, never the
    // lender's — a partner's battery pricing is not a rep's pay agreement.
    await raw.solarDesign.update({ where: { leadId }, data: { systemType: "storage" } });
    await inSolar(() => recomputeDealMoney(companyId, leadId));
    await raw.user.update({
      where: { id: repId },
      data: { solarBatteryPayPlan: "flat", solarPerBatteryFlatCents: 50_000 },
    });

    const { est, line } = await bothAgree();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(line!.solarBasis).toBe("battery_flat");
    // $500 a battery, two of them.
    expect(line!.solarGrossAmount).toBe(100_000);
  });

  it("BATTERY-ONLY with NO plan on the rep is refused by both, not guessed", async () => {
    await raw.solarDesign.update({ where: { leadId }, data: { systemType: "storage" } });
    await inSolar(() => recomputeDealMoney(companyId, leadId));
    await raw.user.update({
      where: { id: repId },
      data: { solarBatteryPayPlan: null, solarPerBatteryFlatCents: null },
    });

    const est = await estimate();
    const { created } = await runPayroll();
    expect(est.state).not.toBe("estimate");
    expect(created).toBe(0);
    expect(await payrollLine()).toBeNull();
  });
});

describe("who supplied the lead", () => {
  beforeEach(async () => {
    await lenderPaying("redline");
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE } });
    await sign();
  });

  it("a REP-GENERATED lead is not docked, and both sides say so", async () => {
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "redline", redlineCentsPerWatt: REDLINE, signedAt: new Date(),
        companyProvidedLead: false, leadAdjustMode: "percentage", companyLeadTakePct: 40,
      },
    });
    const { est, line } = await bothAgree();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    // The percentage is configured but the lead is the rep's, so nothing is
    // taken: net equals gross. This is the case a naive reading gets wrong.
    expect(line!.amount).toBe(line!.solarGrossAmount);
  });

  it("a COMPANY lead on a FLAT take is docked identically by both", async () => {
    await raw.solarDealComp.create({
      data: {
        companyId, leadId, vertical: "solar", repId,
        basis: "redline", redlineCentsPerWatt: REDLINE, signedAt: new Date(),
        companyProvidedLead: true, leadAdjustMode: "flat", companyLeadFlatCents: 75_000,
      },
    });
    const { est, line } = await bothAgree();
    expect(est.state === "estimate" && est.netCents).toBe(line!.amount);
    expect(line!.amount).toBe(line!.solarGrossAmount! - 75_000);
  });
});

describe("a MANAGER override rides beside the rep's line, not inside it", () => {
  it("the rep's own figure is untouched by an override, on both sides", async () => {
    await lenderPaying("redline");
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE } });

    const before = await bothAgree();

    const manager = await raw.user.create({
      data: {
        companyId, email: `mgr-agree-${process.pid}-${Date.now()}@test.local`,
        firstName: "Mo", lastName: "Manager", role: "manager", passwordHash: "x",
      },
      select: { id: true },
    });
    const override = await raw.commissionOverride.create({
      data: {
        companyId, beneficiaryId: manager.id, sourceId: repId,
        vertical: "solar", percent: 10,
      },
      select: { id: true },
    });

    const after = await bothAgree();

    // The estimate is the REP's, and an override paid to somebody else must not
    // move it — the deal page would otherwise quote the rep a number that
    // shrinks when their manager is enrolled.
    expect(after.est.state === "estimate" && after.est.netCents).toBe(after.line!.amount);
    expect(after.line!.amount).toBe(before.line!.amount);

    // …and the override itself is written as its own line, against the manager.
    const mgrLine = await raw.commission.findFirst({
      where: { companyId, projectId, userId: manager.id },
      select: { amount: true, overrideId: true },
    });
    expect(mgrLine).not.toBeNull();
    expect(mgrLine!.overrideId).toBe(override.id);
    expect(mgrLine!.amount).toBe(Math.round(after.line!.amount * 0.1));
  });
});
