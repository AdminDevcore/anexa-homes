import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";
import { runUnscoped } from "@/server/vertical/context";
import { computeCommissionsForProject } from "@/server/modules/payroll/engine";
import {
  finalizeLeadClassification,
  reassignSolarDealRep,
  establishHistoricalComp,
  dealsNeedingCompReview,
} from "@/server/modules/solar/deal-comp";
import { estimatedSolarCommission } from "@/server/modules/payroll/solar-engine";
import { addPayrollAdjustment } from "@/server/modules/payroll/adjustments";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * The three rules that decide what a signed solar deal pays.
 *
 *   1. TERMS ARE FROZEN AT SIGNING. Raising a rep's redline afterwards must not
 *      reprice a deal they already sold. The commission row already snapshotted
 *      terms, but it is not written until M1 — months later — so the freeze has
 *      to happen earlier, on SolarDealComp.
 *   2. THE COMPANY'S LEAD TAKE COMES OFF THE REP'S GROSS, and only once M1 has
 *      finalised the classification. Undecided pays as self-generated.
 *   3. A PERCENTAGE OVERRIDE IS A SHARE OF THE REP'S FINAL COMMISSION, not of
 *      the contract price. Off the contract, a manager earned thousands on a
 *      deal where the rep sold at their redline and earned nothing.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;
let repId: string;
let otherRepId: string;
let managerId: string;
let lenderId: string;

/** 10 kW at a $3.00/W base against a $2.00/W redline → $10,000 gross. */
const KW = 10;
const REDLINE_CENTS = 200;
const GROSS_PPW = 300;

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Comp Snapshot Co", slug: `cs-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  const rep = await raw.user.create({
    data: {
      companyId, email: `rep-cs-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Snap", lastName: "Rep", role: "sales_rep", verticals: ["solar"],
      solarRedlineCentsPerWatt: REDLINE_CENTS,
      solarLeadAdjustMode: "percentage",
      solarCompanyLeadTakePct: 25,
      solarCompanyLeadFlatCents: 1_500_00,
    },
  });
  repId = rep.id;

  const other = await raw.user.create({
    data: {
      companyId, email: `rep2-cs-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Other", lastName: "Rep", role: "sales_rep", verticals: ["solar"],
      solarRedlineCentsPerWatt: 100,
    },
  });
  otherRepId = other.id;

  const manager = await raw.user.create({
    data: {
      companyId, email: `mgr-cs-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Snap", lastName: "Manager", role: "manager", verticals: ["solar"],
    },
  });
  managerId = manager.id;

  const lender = await raw.solarLender.create({
    data: { companyId, name: "Redline Bank", repPayMode: "redline", batteryPayMode: "redline" },
  });
  lenderId = lender.id;
}

/** A signed solar deal with its terms already frozen. */
async function makeSignedDeal(tag: string): Promise<{ projectId: string; leadId: string }> {
  const lead = await raw.lead.create({
    data: { companyId, vertical: "solar", firstName: tag, lastName: "Deal", assignedRepId: repId },
  });
  await raw.solarDesign.create({
    data: { companyId, leadId: lead.id, systemSizeKwDc: KW, lenderId },
  });
  await raw.solarFinance.create({
    data: {
      companyId, leadId: lead.id, product: "loan",
      grossPpwCents: GROSS_PPW, dealerFeePct: 0, adderTotalCents: 0,
      contractPriceCents: KW * 1000 * GROSS_PPW,
    },
  });
  // A real signature, because the engine now asks whether one exists before it
  // is willing to fall back to the rep's current profile.
  await raw.solarProposal.create({
    data: {
      companyId, leadId: lead.id, version: 1,
      publicToken: `tok-${tag}-${process.pid}-${Date.now()}`,
      snapshot: {}, status: "signed", signedAt: new Date("2026-01-15T12:00:00Z"),
    },
  });
  await raw.solarDealComp.create({
    data: {
      companyId, leadId: lead.id, repId,
      basis: "redline", redlineCentsPerWatt: REDLINE_CENTS,
      signedAt: new Date("2026-01-15T12:00:00Z"),
    },
  });
  const project = await raw.project.create({
    data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `${tag}-1`, contractValue: 0 },
  });
  return { projectId: project.id, leadId: lead.id };
}

const computeFor = (projectId: string) =>
  runUnscoped("test: payroll runs company-wide", () =>
    computeCommissionsForProject(db, companyId, projectId)
  );

const repLine = (projectId: string, userId = repId) =>
  raw.commission.findFirst({
    where: { projectId, userId, overrideId: null },
    select: {
      amount: true, solarGrossAmount: true,
      solarCompanyLeadTakePct: true, solarCompanyLeadFlatCents: true,
      solarRedlineCentsPerWatt: true, label: true,
    },
  });

const overrideLine = (projectId: string) =>
  raw.commission.findFirst({
    where: { projectId, overrideId: { not: null } },
    select: { amount: true, baseAmount: true, userId: true, label: true },
  });

beforeAll(resetFixtures);
afterAll(() => raw.$disconnect());

describe("terms are frozen at signing", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
  });

  it("pays the redline the deal was SOLD on, not the rep's redline today", async () => {
    const { projectId } = await makeSignedDeal("frozen");

    // The rep's redline is raised AFTER signing — a raise must never reach back.
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 280 } });

    await computeFor(projectId);
    const line = await repLine(projectId);

    // Sold at $2.00/W: $30,000 base − $20,000 = $10,000 gross.
    // At $2.80/W it would have been only $2,000.
    expect(line?.solarGrossAmount).toBe(10_000_00);
    expect(line?.solarRedlineCentsPerWatt).toBe(REDLINE_CENTS);

    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE_CENTS } });
  });
});

describe("the company's lead take", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
  });

  it("pays the rep in full while the classification is undecided", async () => {
    const { projectId } = await makeSignedDeal("undecided");
    await computeFor(projectId);
    const line = await repLine(projectId);
    expect(line?.amount).toBe(10_000_00);
    expect(line?.solarGrossAmount).toBe(10_000_00);
    expect(line?.solarCompanyLeadTakePct).toBeNull();
  });

  it("takes the COMPANY's percentage once M1 finalises it as company-provided", async () => {
    const { projectId, leadId } = await makeSignedDeal("provided");
    await finalizeLeadClassification({
      companyId, leadId, companyProvided: true, finalizedBy: managerId,
    });

    await computeFor(projectId);
    const line = await repLine(projectId);

    // 25% COMPANY take on $10,000 → the rep is paid $7,500, not $2,500.
    expect(line?.solarGrossAmount).toBe(10_000_00);
    expect(line?.amount).toBe(7_500_00);
    expect(line?.solarCompanyLeadTakePct).toBe(25);
  });

  it("pays in full when M1 finalises it as self-generated", async () => {
    const { projectId, leadId } = await makeSignedDeal("selfgen");
    await finalizeLeadClassification({
      companyId, leadId, companyProvided: false, finalizedBy: managerId,
    });

    await computeFor(projectId);
    const line = await repLine(projectId);
    expect(line?.amount).toBe(10_000_00);
  });

  it("snapshots the rate, so raising the take later cannot reprice a funded deal", async () => {
    const { projectId, leadId } = await makeSignedDeal("ratefrozen");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });

    await raw.user.update({ where: { id: repId }, data: { solarCompanyLeadTakePct: 60 } });
    await computeFor(projectId);

    expect((await repLine(projectId))?.amount).toBe(7_500_00); // still 25%
    await raw.user.update({ where: { id: repId }, data: { solarCompanyLeadTakePct: 25 } });
  });

  it("finalising twice does not move the classification", async () => {
    const { leadId } = await makeSignedDeal("twice");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    await finalizeLeadClassification({ companyId, leadId, companyProvided: false, finalizedBy: null });
    const comp = await raw.solarDealComp.findUnique({ where: { leadId }, select: { companyProvidedLead: true } });
    expect(comp?.companyProvidedLead).toBe(true);
  });
});

describe("manager overrides", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
    await raw.commissionOverride.deleteMany({ where: { companyId } });
  });

  it("a percentage override is a share of the rep's FINAL commission", async () => {
    const { projectId, leadId } = await makeSignedDeal("ovr");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 10 },
    });

    await computeFor(projectId);
    const line = await overrideLine(projectId);

    // Rep final $7,500 → 10% = $750.
    // Off the $30,000 contract it would have been $3,000.
    expect(line?.amount).toBe(750_00);
    expect(line?.baseAmount).toBe(7_500_00);
    expect(line?.userId).toBe(managerId);
    expect(line?.label).toContain("of their commission");
  });

  it("does not reduce what the rep is paid", async () => {
    const { projectId } = await makeSignedDeal("ovr2");
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 10 },
    });
    await computeFor(projectId);
    expect((await repLine(projectId))?.amount).toBe(10_000_00);
  });

  it("pays every qualifying manager, and they do not compete", async () => {
    const second = await raw.user.create({
      data: {
        companyId, email: `mgr2-cs-${process.pid}@test.local`, passwordHash: "x",
        firstName: "Second", lastName: "Manager", role: "manager", verticals: ["solar"],
      },
    });
    const { projectId } = await makeSignedDeal("twomgr");
    await raw.commissionOverride.createMany({
      data: [
        { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 10 },
        { companyId, beneficiaryId: second.id, sourceId: repId, vertical: "solar", type: "percentage", percent: 5 },
      ],
    });

    await computeFor(projectId);
    const lines = await raw.commission.findMany({
      where: { projectId, overrideId: { not: null } },
      select: { userId: true, amount: true },
    });

    expect(lines).toHaveLength(2);
    expect(lines.find((l) => l.userId === managerId)?.amount).toBe(1_000_00);
    expect(lines.find((l) => l.userId === second.id)?.amount).toBe(500_00);
    // …and the rep still has all of theirs.
    expect((await repLine(projectId))?.amount).toBe(10_000_00);
  });

  it("a FLAT override is unchanged — a flat amount is not a function of anything", async () => {
    const { projectId, leadId } = await makeSignedDeal("flatovr");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "flat", flatAmount: 250_00 },
    });
    await computeFor(projectId);
    expect((await overrideLine(projectId))?.amount).toBe(250_00);
  });
});

describe("super-admin reassignment", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
  });

  it("moves the commission and leaves a trail", async () => {
    const { leadId } = await makeSignedDeal("reassign");
    const res = await reassignSolarDealRep({
      companyId, leadId, newRepId: otherRepId, actorId: managerId, reason: "Rep left the company",
    });
    expect(res.ok).toBe(true);

    const comp = await raw.solarDealComp.findUnique({
      where: { leadId },
      select: { repId: true, reassignedFromId: true, reassignedById: true, reassignReason: true, reassignedAt: true },
    });
    expect(comp?.repId).toBe(otherRepId);
    expect(comp?.reassignedFromId).toBe(repId);
    expect(comp?.reassignedById).toBe(managerId);
    expect(comp?.reassignReason).toBe("Rep left the company");
    expect(comp?.reassignedAt).toBeInstanceOf(Date);

    const logged = await raw.activityLog.findFirst({
      where: { leadId, type: "assignment" },
      select: { message: true },
    });
    expect(logged?.message).toContain("Rep left the company");

    // The TERMS do not move: the new rep inherits the deal's $2.00/W redline,
    // not their own $1.00/W one. Repricing a signed deal against a different
    // person's terms would change what the sale earns after the customer signed.
    const deal = await raw.solarDealComp.findUnique({
      where: { leadId }, select: { redlineCentsPerWatt: true },
    });
    expect(deal?.redlineCentsPerWatt).toBe(REDLINE_CENTS);
  });

  it("refuses without a reason", async () => {
    const { leadId } = await makeSignedDeal("noreason");
    const res = await reassignSolarDealRep({
      companyId, leadId, newRepId: otherRepId, actorId: managerId, reason: "  ",
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/reason/i);
  });

  it("refuses to reassign to the rep who already holds it", async () => {
    const { leadId } = await makeSignedDeal("same");
    const res = await reassignSolarDealRep({
      companyId, leadId, newRepId: repId, actorId: managerId, reason: "no-op",
    });
    expect(res.ok).toBe(false);
  });
});

describe("the flat lead deduction, and mode exclusivity", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
  });

  it("FLAT deducts the configured amount: $10,000 less $1,500 = $8,500", async () => {
    const { projectId, leadId } = await makeSignedDeal("flatlead");
    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "flat" } });
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });

    await computeFor(projectId);
    const line = await repLine(projectId);

    expect(line?.solarGrossAmount).toBe(10_000_00);
    expect(line?.amount).toBe(8_500_00);
    expect(line?.solarCompanyLeadFlatCents).toBe(1_500_00);
    // EXCLUSIVITY: the percentage is not also applied, and is not recorded.
    expect(line?.solarCompanyLeadTakePct).toBeNull();

    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "percentage" } });
  });

  it("PERCENTAGE ignores the stale flat amount on the same profile", async () => {
    const { projectId, leadId } = await makeSignedDeal("pctlead");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    await computeFor(projectId);
    const line = await repLine(projectId);
    // 25% of $10,000 = $7,500 — not $6,000 (both) and not $8,500 (flat).
    expect(line?.amount).toBe(7_500_00);
    expect(line?.solarCompanyLeadFlatCents).toBeNull();
  });

  it("mode NONE pays in full even on a company-provided lead", async () => {
    const { projectId, leadId } = await makeSignedDeal("nonelead");
    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "none" } });
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    await computeFor(projectId);
    expect((await repLine(projectId))?.amount).toBe(10_000_00);
    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "percentage" } });
  });

  it("snapshots the MODE, so switching a rep's method cannot reprice a funded deal", async () => {
    const { projectId, leadId } = await makeSignedDeal("modefrozen");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });
    // The rep moves to a flat deduction AFTER M1 settled the percentage.
    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "flat" } });
    await computeFor(projectId);
    expect((await repLine(projectId))?.amount).toBe(7_500_00); // still the percentage
    await raw.user.update({ where: { id: repId }, data: { solarLeadAdjustMode: "percentage" } });
  });
});

describe("manager override — all four shapes on one deal", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
    await raw.commissionOverride.deleteMany({ where: { companyId } });
  });

  it("$/W, percentage and flat managers all pay, and none touches the rep", async () => {
    const mgrPpw = await raw.user.create({
      data: { companyId, email: `m-ppw-${process.pid}@t.local`, passwordHash: "x", firstName: "Watt", lastName: "Mgr", role: "manager", verticals: ["solar"] },
    });
    const mgrFlat = await raw.user.create({
      data: { companyId, email: `m-flat-${process.pid}@t.local`, passwordHash: "x", firstName: "Flat", lastName: "Mgr", role: "manager", verticals: ["solar"] },
    });

    const { projectId, leadId } = await makeSignedDeal("threemgr");
    await finalizeLeadClassification({ companyId, leadId, companyProvided: true, finalizedBy: null });

    await raw.commissionOverride.createMany({
      data: [
        { companyId, beneficiaryId: mgrPpw.id, sourceId: repId, vertical: "solar", type: "ppw", perWattMills: 50 },
        { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 10 },
        { companyId, beneficiaryId: mgrFlat.id, sourceId: repId, vertical: "solar", type: "flat", flatAmount: 250_00 },
      ],
    });

    await computeFor(projectId);
    const lines = await raw.commission.findMany({
      where: { projectId, overrideId: { not: null } },
      select: { userId: true, amount: true, baseAmount: true, label: true },
    });

    expect(lines).toHaveLength(3);
    // 10 kW = 10,000 W × 50 mills ÷ 10 = $500, independent of the rep.
    const ppw = lines.find((l) => l.userId === mgrPpw.id);
    expect(ppw?.amount).toBe(500_00);
    expect(ppw?.baseAmount).toBe(10_000); // the watts
    expect(ppw?.label).toContain("$0.05/W");

    // 10% of the rep's FINAL $7,500 = $750.
    expect(lines.find((l) => l.userId === managerId)?.amount).toBe(750_00);
    expect(lines.find((l) => l.userId === mgrFlat.id)?.amount).toBe(250_00);

    // The rep keeps every cent of their own number.
    expect((await repLine(projectId))?.amount).toBe(7_500_00);
  });

  it("$/W does not move when the rep's commission moves", async () => {
    const mgrPpw = await raw.user.create({
      data: { companyId, email: `m-ppw2-${process.pid}@t.local`, passwordHash: "x", firstName: "Watt2", lastName: "Mgr", role: "manager", verticals: ["solar"] },
    });
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: mgrPpw.id, sourceId: repId, vertical: "solar", type: "ppw", perWattMills: 50 },
    });

    const selfGen = await makeSignedDeal("ppw-self");
    await computeFor(selfGen.projectId); // no lead adjustment → rep $10,000

    const provided = await makeSignedDeal("ppw-prov");
    await finalizeLeadClassification({ companyId, leadId: provided.leadId, companyProvided: true, finalizedBy: null });
    await computeFor(provided.projectId); // 25% take → rep $7,500

    const a = await raw.commission.findFirstOrThrow({ where: { projectId: selfGen.projectId, userId: mgrPpw.id }, select: { amount: true } });
    const b = await raw.commission.findFirstOrThrow({ where: { projectId: provided.projectId, userId: mgrPpw.id }, select: { amount: true } });
    expect(a.amount).toBe(500_00);
    expect(b.amount).toBe(500_00);
  });
});

describe("a signed deal never falls back to today's settings", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
  });

  /**
   * The scenario from the spec, end to end:
   *   1. a deal signs with no usable snapshot
   *   2. the rep's redline is changed afterwards
   *   3. the deal reaches M1
   *   4. the engine must NOT pay on the new redline
   *   5. it must flag and block instead
   */
  it("blocks and flags rather than repricing on the current redline", async () => {
    const lead = await raw.lead.create({
      data: { companyId, vertical: "solar", firstName: "Legacy", lastName: "Signed", assignedRepId: repId },
    });
    await raw.solarDesign.create({ data: { companyId, leadId: lead.id, systemSizeKwDc: KW, lenderId } });
    await raw.solarFinance.create({
      data: {
        companyId, leadId: lead.id, product: "loan",
        grossPpwCents: GROSS_PPW, dealerFeePct: 0, adderTotalCents: 0,
        contractPriceCents: KW * 1000 * GROSS_PPW,
      },
    });
    await raw.solarProposal.create({
      data: {
        companyId, leadId: lead.id, version: 1,
        publicToken: `tok-legacy-${process.pid}-${Date.now()}`,
        snapshot: {}, status: "signed", signedAt: new Date("2026-01-15T12:00:00Z"),
      },
    });
    // The unresolved marker a failed signing writes.
    await raw.solarDealComp.create({
      data: {
        companyId, leadId: lead.id, repId,
        basis: "unresolved", signedAt: new Date("2026-01-15T12:00:00Z"),
        needsReview: true, reviewNote: "Signed before terms were configured.",
      },
    });
    const project = await raw.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `LEG-${Date.now()}`, contractValue: 0 },
    });

    // The rep's redline changes after signing — the trap.
    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 100 } });

    const result = await computeFor(project.id);

    // NOTHING was paid, on the new redline or any other.
    expect(await raw.commission.count({ where: { projectId: project.id } })).toBe(0);
    // At $1.00/W the engine would have paid $20,000. It paid nothing.
    expect(result).toBeGreaterThanOrEqual(0);

    const flagged = await dealsNeedingCompReview(companyId);
    expect(flagged.map((f) => f.leadId)).toContain(lead.id);

    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: REDLINE_CENTS } });
  });

  it("an admin establishing the historical terms unblocks it", async () => {
    const flagged = await dealsNeedingCompReview(companyId);
    const target = flagged[0];
    expect(target).toBeTruthy();

    const res = await establishHistoricalComp({
      companyId, leadId: target.leadId, actorId: managerId,
      note: "Signed under the $2.00/W redline per the 2026 comp plan",
      terms: { basis: "redline", redlineCentsPerWatt: REDLINE_CENTS },
    });
    expect(res.ok).toBe(true);

    const comp = await raw.solarDealComp.findUniqueOrThrow({
      where: { leadId: target.leadId },
      select: { needsReview: true, basis: true, redlineCentsPerWatt: true, reviewResolvedById: true, reviewResolvedAt: true },
    });
    expect(comp.needsReview).toBe(false);
    expect(comp.basis).toBe("redline");
    expect(comp.redlineCentsPerWatt).toBe(REDLINE_CENTS);
    expect(comp.reviewResolvedById).toBe(managerId);
    expect(comp.reviewResolvedAt).toBeInstanceOf(Date);

    // …and it is audited.
    const logged = await raw.activityLog.findFirst({
      where: { leadId: target.leadId, message: { contains: "Historical solar compensation established" } },
      select: { message: true },
    });
    expect(logged?.message).toContain("2026 comp plan");
  });

  it("refuses to overwrite terms that resolved correctly at signing", async () => {
    const { leadId } = await makeSignedDeal("nooverwrite");
    const res = await establishHistoricalComp({
      companyId, leadId, actorId: managerId, note: "trying to change a good one",
      terms: { basis: "per_watt", millsPerWatt: 9999 },
    });
    expect(res.ok).toBe(false);
    expect(res.error).toMatch(/already established/i);
  });
});

describe("approved commissions are immutable", () => {
  it("a later run does not rewrite or delete an APPROVED line", async () => {
    const { projectId } = await makeSignedDeal("approved");
    await computeFor(projectId);

    const line = await raw.commission.findFirstOrThrow({
      where: { projectId, userId: repId, overrideId: null },
      select: { id: true, amount: true },
    });
    await raw.commission.update({ where: { id: line.id }, data: { status: "approved" } });

    // The design grows, which would ordinarily move a pending line.
    await raw.solarFinance.updateMany({
      where: { leadId: (await raw.project.findUniqueOrThrow({ where: { id: projectId }, select: { leadId: true } })).leadId! },
      data: { grossPpwCents: 400 },
    });
    await computeFor(projectId);

    const after = await raw.commission.findUniqueOrThrow({
      where: { id: line.id }, select: { amount: true, status: true },
    });
    expect(after.amount).toBe(line.amount);
    expect(after.status).toBe("approved");
  });
});

/**
 * BATTERY-ONLY PAY BELONGS TO THE REP.
 *
 * The rule that changed on 2026-09-06: it used to be read off the lender's
 * `batteryPayMode`, so every rep selling through Amos was paid the same way
 * whatever their agreement said. Two reps, one lender, one identical deal — and
 * different pay.
 */
describe("standalone battery pay is a property of the REP, not the lender", () => {
  it("two reps on the SAME lender are paid on their own plans", async () => {
    const marginRep = await raw.user.create({
      data: {
        companyId, email: `bat-m-${process.pid}@t.local`, passwordHash: "x",
        firstName: "Margin", lastName: "Rep", role: "sales_rep", verticals: ["solar"],
        solarBatteryPayPlan: "margin",
        // The company's battery cost basis: everything above it is the rep's.
        solarRedlinePerBatteryCents: 9_000_00,
      },
    });
    const flatRep = await raw.user.create({
      data: {
        companyId, email: `bat-f-${process.pid}@t.local`, passwordHash: "x",
        firstName: "Flat", lastName: "Rep", role: "sales_rep", verticals: ["solar"],
        solarBatteryPayPlan: "flat",
        solarPerBatteryFlatCents: 1_500_00,
      },
    });

    // ONE lender, whose own battery mode is deliberately set to `flat` — the
    // margin rep must still be paid on margin.
    const sharedLender = await raw.solarLender.create({
      data: { companyId, name: "One Bank", repPayMode: "per_watt", batteryPayMode: "flat" },
    });

    async function batteryDeal(tag: string, ownerId: string): Promise<string> {
      const lead = await raw.lead.create({
        data: { companyId, vertical: "solar", firstName: tag, lastName: "Batt", assignedRepId: ownerId },
      });
      await raw.solarDesign.create({
        data: {
          companyId, leadId: lead.id, systemType: "storage",
          systemSizeKwDc: 0, batteryQty: 2, lenderId: sharedLender.id,
        },
      });
      await raw.solarFinance.create({
        data: {
          companyId, leadId: lead.id, product: "loan",
          grossPpwCents: 0, stickerPricePerBatteryCents: 12_000_00,
          dealerFeePct: 0, adderTotalCents: 0, contractPriceCents: 24_000_00,
        },
      });
      const project = await raw.project.create({
        data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `${tag}-${Date.now()}`, contractValue: 0 },
      });
      return project.id;
    }

    const aProject = await batteryDeal("MARGIN", marginRep.id);
    const bProject = await batteryDeal("FLAT", flatRep.id);
    await computeFor(aProject);
    await computeFor(bProject);

    const a = await raw.commission.findFirstOrThrow({
      where: { projectId: aProject, userId: marginRep.id },
      select: { amount: true, solarBasis: true },
    });
    const b = await raw.commission.findFirstOrThrow({
      where: { projectId: bProject, userId: flatRep.id },
      select: { amount: true, solarBasis: true },
    });

    // Margin: $24,000 sold − ($9,000 × 2 cost) = $6,000.
    expect(a.solarBasis).toBe("battery_redline");
    expect(a.amount).toBe(6_000_00);

    // Flat: 2 × $1,500 = $3,000, whatever it sold for.
    expect(b.solarBasis).toBe("battery_flat");
    expect(b.amount).toBe(3_000_00);

    // The point: same lender, same deal, different pay.
    expect(a.amount).not.toBe(b.amount);
  });

  it("a rep with no battery plan configured is paid nothing rather than guessed at", async () => {
    const noPlan = await raw.user.create({
      data: {
        companyId, email: `bat-n-${process.pid}@t.local`, passwordHash: "x",
        firstName: "NoPlan", lastName: "Rep", role: "sales_rep", verticals: ["solar"],
        solarBatteryPayPlan: null,
        solarRedlinePerBatteryCents: 9_000_00,
        solarPerBatteryFlatCents: 1_500_00,
      },
    });
    const lead = await raw.lead.create({
      data: { companyId, vertical: "solar", firstName: "NoPlan", lastName: "Batt", assignedRepId: noPlan.id },
    });
    await raw.solarDesign.create({
      data: { companyId, leadId: lead.id, systemType: "storage", systemSizeKwDc: 0, batteryQty: 2, lenderId },
    });
    await raw.solarFinance.create({
      data: {
        companyId, leadId: lead.id, product: "loan", grossPpwCents: 0,
        stickerPricePerBatteryCents: 12_000_00, dealerFeePct: 0, adderTotalCents: 0,
        contractPriceCents: 24_000_00,
      },
    });
    const project = await raw.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `NOPLAN-${Date.now()}`, contractValue: 0 },
    });

    await computeFor(project.id);
    // Neither plan was guessed at, so no line exists at all.
    expect(await raw.commission.count({ where: { projectId: project.id, userId: noPlan.id } })).toBe(0);
  });
});

describe("the deal's ESTIMATED commission", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
    await raw.payrollAdjustment.deleteMany({ where: { companyId } });
    await raw.payrollRun.deleteMany({ where: { companyId } });
  });

  it("reads the SIGNED snapshot, not the rep's settings today", async () => {
    const { leadId } = await makeSignedDeal("EstSigned");

    const before = await runUnscoped("test", () => estimatedSolarCommission(db, companyId, leadId));
    expect(before.state).toBe("estimate");
    if (before.state !== "estimate") return;
    expect(before.fromSnapshot).toBe(true);
    expect(before.grossCents).toBe(10_000_00);

    // The rep gets a raise. The signed deal must not move with it.
    await raw.user.update({
      where: { id: repId },
      data: { solarRedlineCentsPerWatt: 50 },
    });
    const after = await runUnscoped("test", () => estimatedSolarCommission(db, companyId, leadId));
    if (after.state !== "estimate") throw new Error("expected an estimate");
    expect(after.grossCents).toBe(10_000_00);

    await raw.user.update({
      where: { id: repId },
      data: { solarRedlineCentsPerWatt: REDLINE_CENTS },
    });
  });

  it("A PAYROLL ADJUSTMENT DOES NOT REWRITE IT — the deal and the cheque differ, and both are right", async () => {
    const { leadId, projectId } = await makeSignedDeal("EstAdjust");
    await finalizeLeadClassification({
      companyId, leadId, companyProvided: false, finalizedBy: repId,
    });
    await computeFor(projectId);

    const estimateBefore = await runUnscoped("test", () =>
      estimatedSolarCommission(db, companyId, leadId)
    );
    if (estimateBefore.state !== "estimate") throw new Error("expected an estimate");
    expect(estimateBefore.netCents).toBe(10_000_00);

    const line = await repLine(projectId);
    expect(line?.amount).toBe(10_000_00);

    // Payroll docks $1,000 for trenching and adds a $500 bonus.
    const run = await raw.payrollRun.create({
      data: {
        companyId, label: "Week of adjustment",
        periodStart: new Date("2026-02-02"), periodEnd: new Date("2026-02-06"),
      },
      select: { id: true },
    });
    await addPayrollAdjustment({
      companyId, payrollRunId: run.id, userId: repId, kind: "deduction",
      amountCents: 1_000_00, reason: "Trenching - 100 ft @ $10/ft", createdById: repId,
    });
    await addPayrollAdjustment({
      companyId, payrollRunId: run.id, userId: repId, kind: "bonus",
      amountCents: 500_00, reason: "Company bonus", createdById: repId,
    });

    // The DEAL still says $10,000 — the adjustments changed the cheque, not the sale.
    const estimateAfter = await runUnscoped("test", () =>
      estimatedSolarCommission(db, companyId, leadId)
    );
    if (estimateAfter.state !== "estimate") throw new Error("expected an estimate");
    expect(estimateAfter.netCents).toBe(10_000_00);

    // …and neither did the approved commission record.
    expect((await repLine(projectId))?.amount).toBe(10_000_00);
  });

  it("says NEEDS REVIEW rather than a number when the deal is blocked", async () => {
    const { leadId } = await makeSignedDeal("EstBlocked");
    await raw.solarDealComp.update({
      where: { leadId },
      data: { needsReview: true, basis: "unresolved" },
    });
    const est = await runUnscoped("test", () => estimatedSolarCommission(db, companyId, leadId));
    expect(est.state).toBe("needs_review");
  });
});

describe("M1 funds the rep; M2 is the company's money", () => {
  beforeEach(async () => {
    await raw.commission.deleteMany({ where: { companyId } });
    await raw.solarMilestone.deleteMany({ where: { companyId } });
    // Earlier blocks leave overrides on this rep — several, deliberately, to
    // prove managers do not compete. Counting lines here means starting from a
    // known one, so clear them and write exactly the override under test.
    await raw.commissionOverride.deleteMany({ where: { companyId } });
  });

  it("a SECOND milestone adds no rep line and no second override", async () => {
    const { leadId, projectId } = await makeSignedDeal("M2Deal");
    await raw.commissionOverride.create({
      data: {
        companyId, beneficiaryId: managerId, sourceId: repId,
        vertical: "solar", type: "percentage", percent: 10,
      },
    });
    await finalizeLeadClassification({
      companyId, leadId, companyProvided: false, finalizedBy: repId,
    });

    // M1 lands: one rep line, one override.
    await raw.solarMilestone.create({
      data: { companyId, leadId, payee: "rep", sequence: 1, label: "M1 funding", amountCents: 0, paidAt: new Date() },
    });
    await computeFor(projectId);
    expect(await raw.commission.count({ where: { projectId, overrideId: null } })).toBe(1);
    expect(await raw.commission.count({ where: { projectId, overrideId: { not: null } } })).toBe(1);

    /* M2 lands — the company's draw. Nothing about it pays anybody again.
     *
     * `financier` at sequence 2 is exactly the shape the retired M1/M2 schedule
     * wrote, and `MilestonePayee` has no `company` value at all: the schema
     * cannot express "a second rep milestone", which is the first line of
     * defence. This proves the second is also true — the engine reads
     * `payee: rep, sequence: 1` and nothing else, so even a funded M2 row sitting
     * on the deal adds no rep line and no second override. */
    await raw.solarMilestone.create({
      data: {
        companyId, leadId, payee: "financier", sequence: 2,
        label: "M2 funding", amountCents: 50_000_00, paidAt: new Date(),
      },
    });
    await computeFor(projectId);
    expect(await raw.commission.count({ where: { projectId, overrideId: null } })).toBe(1);
    expect(await raw.commission.count({ where: { projectId, overrideId: { not: null } } })).toBe(1);
  });

  it("a generated line starts PENDING — approval is a separate, human act", async () => {
    const { leadId, projectId } = await makeSignedDeal("PendingDeal");
    await finalizeLeadClassification({
      companyId, leadId, companyProvided: false, finalizedBy: repId,
    });
    await computeFor(projectId);
    const line = await raw.commission.findFirstOrThrow({
      where: { projectId, overrideId: null },
      select: { status: true, approvedAt: true },
    });
    expect(line.status).toBe("pending");
    expect(line.approvedAt).toBeNull();
  });
});
