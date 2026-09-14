import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { verticalExtension } from "@/server/vertical/extension";

/**
 * ONE DEAL, ALL THE WAY THROUGH.
 *
 *   proposal → signature → locked deal → M1 funding → commission → payroll → ledger
 *
 * Every step below was fixed separately and is tested separately. This walks
 * the whole road once, in order, on a single deal — because the defects that
 * survive a suite of isolated tests are the ones that live in the joins between
 * them, and because "does the money that leaves the bank match the contract the
 * household signed" is a question only the whole journey can answer.
 *
 * It is written as ONE ordered test rather than several: each step depends on
 * the state the last one left, and a `beforeEach` that reset it would be
 * testing seven beginnings instead of one journey.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/storage", () => ({ putObject: vi.fn(async () => undefined) }));

const { saveSolarFinanceAction } = await import("../actions");
const { upsertSolarCommissionAction } = await import("../cockpit-actions");
const { unlockSignedContractAction } = await import("../unlock-actions");
const { moveLeadStage } = await import("@/server/modules/leads/actions");
const { computeSolarCommissionsForProject, estimatedSolarCommission } =
  await import("@/server/modules/payroll/solar-engine");
const { postRunToBookkeeping } = await import("@/server/modules/payroll/post-bookkeeping");
const { payStubBreakdown } = await import("@/server/modules/payroll/adjustments");
const { snapshotSolarDealComp } = await import("../deal-comp");
const { restampLeadValue } = await import("../deal-value");

vi.mock("@/server/modules/notifications/engine", () => ({ fireEvent: vi.fn() }));
vi.mock("@/server/modules/automations/engine", () => ({ runAutomations: vi.fn() }));
vi.mock("@/server/auth/vertical", () => ({ getActiveVertical: vi.fn(async () => "solar") }));

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

/** The deal: 16 kW at $3.50/W, no fee — a cash contract of exactly $56,000. */
const SYSTEM_KW = 16;
const PPW = 350;
const CONTRACT = SYSTEM_KW * 1000 * PPW; // 5_600_000 = $56,000
const NET_AFTER_ITC = Math.round(CONTRACT * 0.7); // 3_920_000 = $39,200
const REDLINE = 200; // $2.00/W

let companyId: string;
let leadId: string;
let projectId: string;
let proposalId: string;
const users: Partial<Record<Role, string>> = {};
let stages: Record<string, string> = {};

const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);
function actAs(role: Role) {
  session.requireUser.mockResolvedValue({
    userId: users[role]!, companyId, role, permissions: {}, fullName: `${role} user`,
  });
}

const snapshotFor = (contractCents: number, netCents: number) => ({
  schemaVersion: 7,
  reference: "SP-LIFE",
  customer: { name: "Whole Journey" },
  system: { sizeKwDc: SYSTEM_KW, moduleQty: 40, year1ProductionKwh: 18_514, offsetPct: 100 },
  financing: {
    product: "cash",
    contractPriceCents: contractCents,
    monthlyPaymentCents: null,
    rateMillsPerKwh: null,
    creditLadder: { netCostCents: netCents },
  },
});

beforeAll(async () => {
  const company = await raw.company.create({
    data: { name: "Lifecycle Co", slug: `life-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  for (const role of ["sales_rep", "manager", "admin", "accounting", "super_admin"] as Role[]) {
    users[role] = (await raw.user.create({
      data: {
        companyId, email: `${role}-life-${process.pid}@test.local`,
        firstName: role, lastName: "U", role, passwordHash: "x",
        ...(role === "sales_rep" ? { solarRedlineCentsPerWatt: REDLINE } : {}),
      },
      select: { id: true },
    })).id;
  }

  const pipeline = await raw.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  // LIVE's own ordering and its renamed funding key.
  for (const [key, name, position, countsAsSold] of [
    ["qualified", "Qualified", 1, false],
    ["contract_signed", "Contract Signed", 5, true],
    ["installed", "Install Complete", 15, false],
    ["partial_funding_26", "M1 Funding", 16, false],
    ["inspection_complete_22", "Inspection Complete", 19, false],
  ] as [string, string, number, boolean][]) {
    stages[key] = (await raw.pipelineStage.create({
      data: { pipelineId: pipeline.id, key, name, position, countsAsSold },
      select: { id: true },
    })).id;
  }

  const lead = await raw.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stages.qualified,
      firstName: "Whole", lastName: "Journey", assignedRepId: users.sales_rep!,
    },
  });
  leadId = lead.id;
  projectId = (await raw.project.create({
    data: {
      companyId, vertical: "solar", leadId, projectNumber: `LIFE-${Date.now()}`,
      // Stamped from `Lead.value` at creation, which on solar is the NET — the
      // starting state of the revenue defect.
      contractValue: NET_AFTER_ITC,
    },
    select: { id: true },
  })).id;

  await raw.solarDesign.create({
    data: {
      companyId, leadId, vertical: "solar", systemType: "pv",
      systemSizeKwDc: SYSTEM_KW, moduleQty: 40,
      year1ProductionKwh: 18_514, annualUsageKwh: 18_400,
    },
  });
});

afterAll(async () => {
  /**
   * Payroll first, then the company.
   *
   * `PayrollItem.userId` carries no cascade, so dropping the company cannot
   * order itself around the users those lines point at. Clearing the run — which
   * cascades its own items — takes the reference out of the way. A fixture
   * detail, not a schema opinion: deleting a company is not a flow this product
   * has, and a foreign key on a money table is not something to relax for a
   * test's convenience.
   */
  await raw.payrollRun.deleteMany({ where: { companyId } });
  await raw.commission.deleteMany({ where: { companyId } });
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

describe("a solar deal from proposal to ledger", () => {
  it("walks the whole road, and the money agrees at every step", async () => {
    // ── 1 · PRICED ────────────────────────────────────────────────────────
    actAs("sales_rep");
    expect(
      (await inSolar(() =>
        saveSolarFinanceAction({
          leadId, product: "cash", grossPpwCents: PPW, dealerFeePct: 0,
        } as Parameters<typeof saveSolarFinanceAction>[0])
      )).ok
    ).toBe(true);
    expect((await raw.solarFinance.findUniqueOrThrow({ where: { leadId } })).contractPriceCents)
      .toBe(CONTRACT);

    // ── 2 · PROPOSED ──────────────────────────────────────────────────────
    proposalId = (await raw.solarProposal.create({
      data: {
        companyId, leadId, version: 1, status: "sent", sentAt: new Date(),
        snapshot: snapshotFor(CONTRACT, NET_AFTER_ITC) as never,
      },
      select: { id: true },
    })).id;

    // ── 3 · SIGNED ────────────────────────────────────────────────────────
    const signedAt = new Date();
    await raw.solarProposal.update({
      where: { id: proposalId },
      data: { status: "signed", signedAt, signerName: "H. Owner", approvedAt: signedAt },
    });
    // What the signature does, the way `acceptSolarProposal` does it.
    await inSolar(() => snapshotSolarDealComp({ companyId, leadId, signedAt }));
    await inSolar(() => restampLeadValue(companyId, leadId));

    const comp = await raw.solarDealComp.findUniqueOrThrow({ where: { leadId } });
    expect(comp.basis).toBe("redline");
    expect(comp.redlineCentsPerWatt).toBe(REDLINE);

    // ── 4 · REVENUE IS THE CONTRACT, NOT THE NET ──────────────────────────
    const project = await raw.project.findUniqueOrThrow({ where: { id: projectId } });
    const leadRow = await raw.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(project.contractValue).toBe(CONTRACT); // $56,000 — what reports read
    expect(project.contractValue).not.toBe(NET_AFTER_ITC); // NOT $39,200
    expect(leadRow.value).toBe(NET_AFTER_ITC); // the pipeline card keeps the net

    // ── 5 · THE DEAL IS LOCKED ────────────────────────────────────────────
    actAs("sales_rep");
    const repRaise = await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "cash", grossPpwCents: 900, dealerFeePct: 0,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    );
    expect(repRaise.ok).toBe(false);
    expect((await raw.solarFinance.findUniqueOrThrow({ where: { leadId } })).contractPriceCents)
      .toBe(CONTRACT);

    // Even a super admin must reopen it and say why.
    actAs("super_admin");
    expect((await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "cash", grossPpwCents: 900, dealerFeePct: 0,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    )).ok).toBe(false);

    // ── 6 · THE REP CANNOT DECLARE THE MONEY ARRIVED ──────────────────────
    actAs("sales_rep");
    // (a) the stage
    const repMove = await inSolar(() =>
      moveLeadStage({ leadId, stageId: stages.partial_funding_26 })
    );
    expect(repMove.ok).toBe(false);
    // (b) the milestone
    const repFund = await inSolar(() =>
      upsertSolarCommissionAction({ leadId, amountCents: 900_000, paid: true })
    );
    expect(repFund.ok).toBe(false);
    expect(await raw.solarMilestone.count({ where: { leadId, paidAt: { not: null } } })).toBe(0);

    // A manager is no better placed.
    actAs("manager");
    expect((await inSolar(() =>
      upsertSolarCommissionAction({ leadId, amountCents: 900_000, paid: true })
    )).ok).toBe(false);

    // ── 7 · THE FUNDING DESK CONFIRMS M1 ──────────────────────────────────
    actAs("accounting");
    expect((await inSolar(() =>
      upsertSolarCommissionAction({ leadId, amountCents: 0, paid: true })
    )).ok).toBe(true);
    expect(await raw.solarMilestone.count({ where: { leadId, paidAt: { not: null } } })).toBe(1);

    // …and now the board opens again for whoever works it.
    actAs("sales_rep");
    expect((await inSolar(() =>
      moveLeadStage({ leadId, stageId: stages.partial_funding_26 })
    )).ok).toBe(true);

    // ── 8 · COMMISSION ────────────────────────────────────────────────────
    const { created, refusals } = await inSolar(() =>
      computeSolarCommissionsForProject(db, companyId, {
        id: projectId, leadId, assignedRepId: users.sales_rep!, repName: "sales_rep U",
      })
    );
    expect(refusals).toEqual([]);
    expect(created).toBe(1);

    const line = await raw.commission.findFirstOrThrow({
      where: { companyId, projectId, userId: users.sales_rep!, overrideId: null },
    });
    // Cash, so no dealer fee: the base IS the contract, and the rep keeps
    // everything above $2.00/W.
    const expectedCommission = CONTRACT - REDLINE * SYSTEM_KW * 1000;
    expect(line.amount).toBe(expectedCommission);
    expect(line.solarBasis).toBe("redline");

    // The deal page quotes the same figure payroll just wrote.
    const est = await inSolar(() => estimatedSolarCommission(db, companyId, leadId));
    expect(est.state).toBe("estimate");
    expect(est.state === "estimate" && est.netCents).toBe(line.amount);
    expect(est.state === "estimate" && est.fromSnapshot).toBe(true);

    // ── 9 · PAYROLL ───────────────────────────────────────────────────────
    await raw.commission.update({
      where: { id: line.id },
      data: { status: "approved", approvedAt: new Date() },
    });
    const run = await raw.payrollRun.create({
      data: {
        companyId, label: "Lifecycle week",
        periodStart: new Date(Date.UTC(2026, 0, 5)),
        periodEnd: new Date(Date.UTC(2026, 0, 9, 23, 59, 59, 999)),
        status: "paid", paidAt: new Date(Date.UTC(2026, 0, 15)),
        items: {
          create: [{
            userId: users.sales_rep!, commissionId: line.id,
            label: "Solar redline — LIFE", amount: line.amount,
          }],
        },
      },
      select: { id: true },
    });
    // A trenching deduction, the example from the brief.
    await raw.payrollAdjustment.create({
      data: {
        companyId, payrollRunId: run.id, userId: users.sales_rep!,
        kind: "deduction", amountCents: -100_000,
        reason: "Trenching — $10/ft x 100 ft", createdById: users.admin!,
      },
    });

    const stub = await payStubBreakdown({
      companyId, payrollRunId: run.id, userId: users.sales_rep!,
    });
    expect(stub.baseCommissionCents).toBe(expectedCommission);
    expect(stub.deductionCents).toBe(-100_000);
    expect(stub.finalCents).toBe(expectedCommission - 100_000);

    // ── 10 · LEDGER ───────────────────────────────────────────────────────
    await postRunToBookkeeping(companyId, run.id, users.admin!);
    const posted = await raw.transaction.findMany({
      where: { companyId, source: `payroll:${run.id}` },
      select: { amountCents: true },
    });
    expect(posted).toHaveLength(2); // the commission, and the deduction

    // THE INVARIANT THE WHOLE JOURNEY IS FOR: what the books say left the
    // account is what the person was actually paid.
    const ledgerTotal = posted.reduce((s, t) => s + t.amountCents, 0);
    expect(ledgerTotal).toBe(-stub.finalCents);

    // Re-posting cannot double it.
    await postRunToBookkeeping(companyId, run.id, users.admin!);
    expect(await raw.transaction.count({ where: { companyId, source: `payroll:${run.id}` } })).toBe(2);

    // ── 11 · AND THE CONTRACT IS STILL $56,000 ────────────────────────────
    const finalProject = await raw.project.findUniqueOrThrow({ where: { id: projectId } });
    expect(finalProject.contractValue).toBe(CONTRACT);
  });

  it("lets a super admin correct the signed contract, on the record", async () => {
    actAs("super_admin");
    const reason = "Lender correction — re-issued at a different rate";
    expect((await inSolar(() => unlockSignedContractAction({ leadId, reason }))).ok).toBe(true);

    const before = (await raw.solarFinance.findUniqueOrThrow({ where: { leadId } })).contractPriceCents;
    expect((await inSolar(() =>
      saveSolarFinanceAction({
        leadId, product: "cash", grossPpwCents: 375, dealerFeePct: 0,
      } as Parameters<typeof saveSolarFinanceAction>[0])
    )).ok).toBe(true);
    const after = (await raw.solarFinance.findUniqueOrThrow({ where: { leadId } })).contractPriceCents;
    expect(after).toBe(SYSTEM_KW * 1000 * 375);

    const logs = await raw.activityLog.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });
    expect(logs.some((l) => l.message.includes(reason) && /reopened/i.test(l.message))).toBe(true);
    const figures = logs.find((l) => /changed the contract price/i.test(l.message));
    expect(figures?.message).toContain(String(before));
    expect(figures?.message).toContain(String(after));
    expect(figures?.message).toContain(reason);
  });
});
