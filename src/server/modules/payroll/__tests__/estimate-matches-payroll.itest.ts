import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

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

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

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
  await db.commission.deleteMany({ where: { companyId } });
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
  return db.commission.findFirst({
    where: { companyId, projectId, userId: repId, overrideId: null },
    select: { amount: true, solarGrossAmount: true, solarBasis: true },
  });
}

async function sign() {
  await db.solarProposal.updateMany({
    where: { leadId },
    data: { status: "signed", signedAt: new Date() },
  });
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Agree Co", slug: `agree-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const rep = await db.user.create({
    data: {
      companyId, email: `rep-agree-${process.pid}@test.local`,
      firstName: "Rhea", lastName: "Rep", role: "sales_rep", passwordHash: "x",
      solarRedlineCentsPerWatt: REDLINE,
    },
    select: { id: true },
  });
  repId = rep.id;

  lenderId = (await db.solarLender.create({
    data: { companyId, name: "Agree Bank", repPayMode: "redline" },
    select: { id: true },
  })).id;

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "m1", name: "M1 Funding", position: 10 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Agree", lastName: "Deal", assignedRepId: repId,
    },
  });
  leadId = lead.id;
  projectId = (await db.project.create({
    data: { companyId, vertical: "solar", leadId, projectNumber: `AG-${Date.now()}` },
    select: { id: true },
  })).id;
});

beforeEach(async () => {
  await db.commission.deleteMany({ where: { companyId } });
  await db.solarDealComp.deleteMany({ where: { leadId } });
  await db.solarProposal.deleteMany({ where: { leadId } });
  await db.solarFinance.deleteMany({ where: { leadId } });
  await db.solarDesign.deleteMany({ where: { leadId } });

  await db.solarDesign.create({
    data: {
      companyId, leadId, vertical: "solar", systemType: "pv",
      systemSizeKwDc: SYSTEM_KW, moduleQty: 30, lenderId,
      year1ProductionKwh: 14_000, annualUsageKwh: 14_000,
    },
  });
  await db.solarFinance.create({
    data: {
      companyId, leadId, vertical: "solar", product: "loan",
      grossPpwCents: PPW, dealerFeePct: FEE,
      contractPriceCents: SYSTEM_KW * 1000 * PPW,
    },
  });
  await db.solarProposal.create({
    data: { companyId, leadId, version: 1, status: "generated", snapshot: { schemaVersion: 7 } as never },
  });
  await db.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
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
    await db.solarDealComp.create({
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
    await db.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 50 } });

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
    expect(await db.solarDealComp.count({ where: { leadId } })).toBe(0);

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
    await db.solarDealComp.create({
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
    await db.commission.create({
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
    await db.solarDealComp.create({
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
