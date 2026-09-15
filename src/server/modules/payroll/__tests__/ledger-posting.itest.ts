import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * WHAT THE LEDGER SAYS LEFT THE ACCOUNT MUST BE WHAT LEFT THE ACCOUNT.
 *
 * `postRunToBookkeeping` wrote one transaction per commission and contractor
 * line and nothing else, so a run carrying a $1,000 trenching deduction booked
 * the GROSS while the bank showed the net. Commission expense was overstated by
 * every deduction, understated by every bonus, and the reconciliation could
 * never close.
 *
 * THE INVARIANT, asserted several ways below:
 *
 *     SUM(transactions for this run) === -SUM(finalCents over every recipient)
 *
 * `finalCents` is what `payStubBreakdown` computes and what the pay stub
 * prints, so the books, the stub and the transfer are three views of one
 * number.
 */

process.env.STORAGE_DRIVER = "db";

// The stub PDF is not under test and rendering one per recipient is slow.
vi.mock("@/server/storage", () => ({ putObject: vi.fn(async () => undefined) }));

const { postRunToBookkeeping } = await import("../post-bookkeeping");
const { payStubBreakdown } = await import("../adjustments");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let repId: string;
let otherRepId: string;
let projectId: string;
let actorId: string;

const COMMISSION = 1_000_000; // $10,000

async function makeRun(label: string) {
  return db.payrollRun.create({
    data: {
      companyId,
      label,
      periodStart: new Date(Date.UTC(2025, 0, 6)),
      periodEnd: new Date(Date.UTC(2025, 0, 10, 23, 59, 59, 999)),
      status: "paid",
      paidAt: new Date(Date.UTC(2025, 0, 16)),
    },
    select: { id: true },
  });
}

async function addCommissionLine(runId: string, userId: string, amount = COMMISSION) {
  const commission = await db.commission.create({
    data: { companyId, projectId, userId, amount, baseAmount: amount, status: "paid", label: "Solar redline" },
    select: { id: true },
  });
  return db.payrollItem.create({
    data: { payrollRunId: runId, userId, commissionId: commission.id, label: "Solar redline — JOB-1", amount },
    select: { id: true },
  });
}

async function addAdjustment(
  runId: string,
  userId: string,
  kind: "bonus" | "deduction" | "chargeback_recovery",
  magnitude: number,
  reason: string
) {
  return db.payrollAdjustment.create({
    data: {
      companyId,
      payrollRunId: runId,
      userId,
      kind,
      // Signed exactly as `addPayrollAdjustment` writes it.
      amountCents: kind === "bonus" ? magnitude : -magnitude,
      reason,
      createdById: actorId,
    },
    select: { id: true },
  });
}

/** Everything this run posted to the ledger. */
const postedFor = (runId: string) =>
  db.transaction.findMany({
    where: { companyId, source: `payroll:${runId}` },
    select: { amountCents: true, description: true, externalId: true, category: { select: { name: true } } },
  });

const postedTotal = async (runId: string) =>
  (await postedFor(runId)).reduce((s, t) => s + t.amountCents, 0);

/** What the run actually pays, summed over everyone on it. */
async function netPaidTotal(runId: string) {
  const [items, adjustments] = await Promise.all([
    db.payrollItem.findMany({ where: { payrollRunId: runId }, select: { userId: true } }),
    db.payrollAdjustment.findMany({ where: { payrollRunId: runId }, select: { userId: true } }),
  ]);
  const userIds = [...new Set([...items, ...adjustments].map((r) => r.userId))];
  let total = 0;
  for (const userId of userIds) {
    const b = await payStubBreakdown({ companyId, payrollRunId: runId, userId });
    total += b.finalCents;
  }
  return total;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Ledger Co", slug: `led-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const mk = async (first: string, role: "sales_rep" | "admin") =>
    (
      await db.user.create({
        data: {
          companyId,
          email: `${first}-led-${process.pid}@test.local`,
          firstName: first,
          lastName: "L",
          role,
          passwordHash: "x",
        },
        select: { id: true },
      })
    ).id;
  repId = await mk("Rhea", "sales_rep");
  otherRepId = await mk("Omar", "sales_rep");
  actorId = await mk("Ada", "admin");

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "m1", name: "M1 Funding", position: 10 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id, firstName: "Led", lastName: "Ger" },
  });
  const project = await db.project.create({
    data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `LED-${Date.now()}` },
  });
  projectId = project.id;
});

beforeEach(async () => {
  await db.transaction.deleteMany({ where: { companyId } });
  await db.payrollAdjustment.deleteMany({ where: { companyId } });
  await db.payrollItem.deleteMany({ where: { payrollRun: { companyId } } });
  await db.payrollRun.deleteMany({ where: { companyId } });
  await db.commission.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("adjustments reach the ledger", () => {
  it("a NEGATIVE adjustment reduces what the books say left the account", async () => {
    // The motivating example: trenching at $10/ft x 100 ft.
    const run = await makeRun("Week of 6 Jan");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "deduction", 100_000, "Trenching — $10/ft x 100 ft");

    await postRunToBookkeeping(companyId, run.id, actorId);

    // -$10,000 for the commission, +$1,000 for the money that did not leave.
    expect(await postedTotal(run.id)).toBe(-(COMMISSION - 100_000));
    expect(await postedTotal(run.id)).toBe(-(await netPaidTotal(run.id)));
  });

  it("a POSITIVE adjustment increases it", async () => {
    const run = await makeRun("Week of 13 Jan");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "bonus", 50_000, "Q1 spiff");

    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedTotal(run.id)).toBe(-(COMMISSION + 50_000));
    expect(await postedTotal(run.id)).toBe(-(await netPaidTotal(run.id)));
  });

  it("several adjustments on one run all land", async () => {
    const run = await makeRun("Week of 20 Jan");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "bonus", 25_000, "Referral");
    await addAdjustment(run.id, repId, "deduction", 100_000, "Trenching");
    await addAdjustment(run.id, repId, "deduction", 7_500, "Materials");

    await postRunToBookkeeping(companyId, run.id, actorId);
    const lines = await postedFor(run.id);
    expect(lines).toHaveLength(4); // one commission + three adjustments
    expect(await postedTotal(run.id)).toBe(-(COMMISSION + 25_000 - 100_000 - 7_500));
    expect(await postedTotal(run.id)).toBe(-(await netPaidTotal(run.id)));
  });

  it("a chargeback recovery books to its OWN category, not against commissions", async () => {
    const run = await makeRun("Week of 27 Jan");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "chargeback_recovery", 250_000, "Clawback instalment");

    await postRunToBookkeeping(companyId, run.id, actorId);
    const lines = await postedFor(run.id);
    const recovery = lines.find((l) => l.description.startsWith("Chargeback recovery"));
    expect(recovery?.category?.name).toBe("Commission Chargebacks");
    expect(recovery?.amountCents).toBe(250_000); // money that stayed
    // …and it did not quietly reduce the commission expense line.
    const commission = lines.find((l) => l.description.startsWith("Solar redline"));
    expect(commission?.amountCents).toBe(-COMMISSION);
    expect(commission?.category?.name).toBe("Sales Commissions");
  });

  it("reconciles across several people on one run", async () => {
    const run = await makeRun("Week of 3 Feb");
    await addCommissionLine(run.id, repId);
    await addCommissionLine(run.id, otherRepId, 700_000);
    await addAdjustment(run.id, repId, "deduction", 100_000, "Trenching");
    await addAdjustment(run.id, otherRepId, "bonus", 30_000, "Spiff");

    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedTotal(run.id)).toBe(-(await netPaidTotal(run.id)));
  });

  it("books a person whose ONLY line is an adjustment", async () => {
    // A rep whose commission was fully clawed back still has money moving.
    const run = await makeRun("Week of 10 Feb");
    await addAdjustment(run.id, otherRepId, "bonus", 40_000, "Standalone bonus");

    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedTotal(run.id)).toBe(-40_000);
    expect(await postedTotal(run.id)).toBe(-(await netPaidTotal(run.id)));
  });
});

describe("posting is idempotent", () => {
  it("marking a run paid twice does not double the ledger", async () => {
    const run = await makeRun("Week of 17 Feb");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "deduction", 100_000, "Trenching");

    await postRunToBookkeeping(companyId, run.id, actorId);
    const first = await postedFor(run.id);
    await postRunToBookkeeping(companyId, run.id, actorId);
    const second = await postedFor(run.id);

    expect(second).toHaveLength(first.length);
    expect(await postedTotal(run.id)).toBe(-(COMMISSION - 100_000));
  });

  it("RESUMES a post that died half way instead of refusing forever", async () => {
    // The old guard was "any transaction for this run? stop" — which locks out
    // recovery from a partial write. Simulate one by posting, then deleting a
    // line as though it had never been written.
    const run = await makeRun("Week of 24 Feb");
    await addCommissionLine(run.id, repId);
    const adj = await addAdjustment(run.id, repId, "deduction", 100_000, "Trenching");

    await postRunToBookkeeping(companyId, run.id, actorId);
    await db.transaction.deleteMany({
      where: { companyId, externalId: `payroll:${run.id}:adj:${adj.id}` },
    });
    expect(await postedFor(run.id)).toHaveLength(1); // the hole

    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedFor(run.id)).toHaveLength(2); // filled, not duplicated
    expect(await postedTotal(run.id)).toBe(-(COMMISSION - 100_000));
  });

  it("picks up an adjustment added after the first post, without duplicating", async () => {
    const run = await makeRun("Week of 3 Mar");
    await addCommissionLine(run.id, repId);
    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedFor(run.id)).toHaveLength(1);

    await addAdjustment(run.id, repId, "bonus", 15_000, "Late spiff");
    await postRunToBookkeeping(companyId, run.id, actorId);

    const lines = await postedFor(run.id);
    expect(lines).toHaveLength(2);
    expect(await postedTotal(run.id)).toBe(-(COMMISSION + 15_000));
  });

  it("gives every line its own key, so none can collide", async () => {
    const run = await makeRun("Week of 10 Mar");
    await addCommissionLine(run.id, repId);
    await addAdjustment(run.id, repId, "bonus", 1_000, "a");
    await addAdjustment(run.id, repId, "deduction", 2_000, "b");

    await postRunToBookkeeping(companyId, run.id, actorId);
    const keys = (await postedFor(run.id)).map((l) => l.externalId);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((k) => k?.startsWith(`payroll:${run.id}:`))).toBe(true);
  });
});

describe("a run with nothing on it", () => {
  it("posts nothing at all", async () => {
    const run = await makeRun("Week of 17 Mar");
    // Categories created by earlier runs in this company legitimately survive —
    // a chart of accounts is not per-run — so the assertion is about what THIS
    // run wrote, which is nothing.
    await postRunToBookkeeping(companyId, run.id, actorId);
    expect(await postedFor(run.id)).toHaveLength(0);
  });

  it("creates no category when the very first run is empty", async () => {
    // The lazy resolution the original code was careful about: a run of nothing
    // must not leave "Contractor Labor" sitting in a fresh chart of accounts.
    const fresh = await db.company.create({
      data: { name: "Fresh Co", slug: `fresh-${process.pid}-${Date.now()}` },
    });
    const run = await db.payrollRun.create({
      data: {
        companyId: fresh.id,
        label: "Empty",
        periodStart: new Date(Date.UTC(2025, 0, 6)),
        periodEnd: new Date(Date.UTC(2025, 0, 10)),
        status: "paid",
      },
      select: { id: true },
    });
    await postRunToBookkeeping(fresh.id, run.id, actorId);
    expect(await db.bookkeepingCategory.count({ where: { companyId: fresh.id } })).toBe(0);
    await db.company.deleteMany({ where: { id: fresh.id } });
  });
});
