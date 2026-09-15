import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { computeReports } from "@/lib/bookkeeping-reports";

/**
 * THE P&L MUST NOT TRUNCATE.
 *
 * `getBookkeepingData` fetched the newest 1,000 transactions for the ledger
 * table and then applied the reporting period to that array IN MEMORY. The
 * arithmetic was right; the set of rows was not. Ask for a quarter that sits
 * below the cut and the statement rendered $0 with nothing saying it was
 * incomplete — and the balance sheet, whose cash figure is cumulative, was
 * wrong by everything older than row 1,000 permanently.
 *
 * This suite writes MORE than the page size on purpose. Anything smaller
 * cannot fail the way production would.
 */

const PAGE = 1000; // TRANSACTION_PAGE — the ledger table's page
const OLD_ROWS = 900; // dated in 2023, i.e. below the cut once the new rows land
const NEW_ROWS = 400; // dated in 2025, enough to push the old ones off the page

const { computeReportsFromDb, jobActivityFromDb } = await import("../reports-db");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let projectId: string;
let incomeCatId: string;
let expenseCatId: string;

const YEAR_2023 = { startMs: Date.UTC(2023, 0, 1), endMs: Date.UTC(2023, 11, 31, 23, 59, 59, 999) };
const YEAR_2025 = { startMs: Date.UTC(2025, 0, 1), endMs: Date.UTC(2025, 11, 31, 23, 59, 59, 999) };

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Truncation Co", slug: `trunc-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const income = await db.bookkeepingCategory.create({
    data: { companyId, name: "Job Revenue", type: "income" },
  });
  incomeCatId = income.id;
  const expense = await db.bookkeepingCategory.create({
    data: { companyId, name: "Materials", type: "expense" },
  });
  expenseCatId = expense.id;

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Roofing", vertical: "roofing" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "roofing", pipelineId: pipeline.id, stageId: stage.id, firstName: "T", lastName: "C" },
  });
  const project = await db.project.create({
    data: { companyId, vertical: "roofing", leadId: lead.id, projectNumber: `TR-${Date.now()}` },
  });
  projectId = project.id;

  // 900 old rows: +$100 income and -$40 expense, alternating, all in 2023.
  const rows: {
    companyId: string; date: Date; description: string; amountCents: number;
    categoryId: string; projectId: string; vertical: "roofing" | "solar";
  }[] = [];
  for (let i = 0; i < OLD_ROWS; i++) {
    const isIncome = i % 2 === 0;
    rows.push({
      companyId,
      date: new Date(Date.UTC(2023, i % 12, (i % 27) + 1)),
      description: `old-${i}`,
      amountCents: isIncome ? 10_000 : -4_000,
      categoryId: isIncome ? incomeCatId : expenseCatId,
      projectId,
      vertical: "roofing",
    });
  }
  // 400 new rows in 2025, which is what pushes 2023 below the page.
  for (let i = 0; i < NEW_ROWS; i++) {
    rows.push({
      companyId,
      date: new Date(Date.UTC(2025, i % 12, (i % 27) + 1)),
      description: `new-${i}`,
      amountCents: 25_000,
      categoryId: incomeCatId,
      projectId,
      vertical: "solar",
    });
  }
  await db.transaction.createMany({ data: rows });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

/** Exactly the page `getBookkeepingData` renders the ledger table from. */
async function newestPage() {
  return db.transaction.findMany({
    where: { companyId },
    orderBy: { date: "desc" },
    take: PAGE,
    select: { date: true, amountCents: true, vertical: true, category: { select: { name: true } } },
  });
}

describe("a ledger larger than the table's page", () => {
  it("is genuinely larger — otherwise this suite proves nothing", async () => {
    const total = await db.transaction.count({ where: { companyId } });
    expect(total).toBe(OLD_ROWS + NEW_ROWS);
    expect(total).toBeGreaterThan(PAGE);
  });

  it("REPRODUCES the truncation when the period is applied in memory", async () => {
    /**
     * The old behaviour, kept as the control.
     *
     * With 1,300 rows and a 1,000-row page, all 400 of the 2025 rows and the
     * newest 600 of 2023 survive; the oldest 300 fall off. So the 2023 P&L
     * comes back UNDERSTATED rather than empty — which is the more dangerous
     * shape of this bug, because a plausible number invites nobody to check it.
     * (A period sitting entirely below the cut reports a clean $0; the same
     * defect, further along.)
     */
    const page = await newestPage();
    const old = computeReports(
      page.map((t) => ({ date: t.date, amountCents: t.amountCents, categoryName: t.category?.name ?? null, vertical: t.vertical })),
      YEAR_2023
    );
    const truth = await computeReportsFromDb(companyId, YEAR_2023);

    expect(page).toHaveLength(PAGE);
    expect(old.pnl.totalIncome).toBeGreaterThan(0); // plausible…
    expect(old.pnl.totalIncome).toBeLessThan(truth.pnl.totalIncome); // …and wrong
    expect(old.pnl.netProfit).not.toBe(truth.pnl.netProfit);
  });

  it("reports 2023 correctly from the database", async () => {
    // 450 income rows at $100, 450 expense rows at $40.
    const expectedIncome = 450 * 10_000;
    const expectedExpense = 450 * 4_000;

    const r = await computeReportsFromDb(companyId, YEAR_2023);
    expect(r.pnl.totalIncome).toBe(expectedIncome);
    expect(r.pnl.totalExpense).toBe(expectedExpense);
    expect(r.pnl.netProfit).toBe(expectedIncome - expectedExpense);
    // …and it is emphatically not the truncated answer.
    expect(r.pnl.totalIncome).not.toBe(0);
  });

  it("reports 2025 correctly too", async () => {
    const r = await computeReportsFromDb(companyId, YEAR_2025);
    expect(r.pnl.totalIncome).toBe(NEW_ROWS * 25_000);
    expect(r.pnl.totalExpense).toBe(0);
  });

  it("reports all time as the sum of both years", async () => {
    const all = await computeReportsFromDb(companyId);
    const y23 = await computeReportsFromDb(companyId, YEAR_2023);
    const y25 = await computeReportsFromDb(companyId, YEAR_2025);
    expect(all.pnl.totalIncome).toBe(y23.pnl.totalIncome + y25.pnl.totalIncome);
    expect(all.pnl.totalExpense).toBe(y23.pnl.totalExpense + y25.pnl.totalExpense);
  });

  it("breaks the period down by category, not merely in total", async () => {
    const r = await computeReportsFromDb(companyId, YEAR_2023);
    expect(r.pnl.income).toEqual([{ name: "Job Revenue", total: 450 * 10_000 }]);
    expect(r.pnl.expense).toEqual([{ name: "Materials", total: 450 * 4_000 }]);
  });

  it("keeps the department breakout reconciling to the consolidated total", async () => {
    const r = await computeReportsFromDb(companyId);
    const segIncome = r.pnl.segments.reduce((s, x) => s + x.totalIncome, 0);
    const segExpense = r.pnl.segments.reduce((s, x) => s + x.totalExpense, 0);
    expect(segIncome).toBe(r.pnl.totalIncome);
    expect(segExpense).toBe(r.pnl.totalExpense);
    // Both verticals are present and neither has swallowed the other.
    expect(r.pnl.segments.map((s) => s.vertical).sort()).toEqual(["roofing", "solar"]);
  });
});

describe("the balance sheet is a snapshot, not a period", () => {
  it("counts everything on or before the end date, with no lower bound", async () => {
    // Cash through end-2023 is the 2023 rows only: 450×$100 − 450×$40.
    const through2023 = await computeReportsFromDb(companyId, YEAR_2023);
    expect(through2023.balanceSheet.totalAssets).toBe(450 * 10_000 - 450 * 4_000);

    // Through end-2025 it is both years — including everything below the page.
    const through2025 = await computeReportsFromDb(companyId, YEAR_2025);
    expect(through2025.balanceSheet.totalAssets).toBe(
      450 * 10_000 - 450 * 4_000 + NEW_ROWS * 25_000
    );
  });

  it("keeps assets, retained earnings and equity in agreement", async () => {
    const r = await computeReportsFromDb(companyId);
    expect(r.balanceSheet.totalEquity).toBe(r.balanceSheet.totalAssets);
    expect(r.balanceSheet.equity[0].total).toBe(r.balanceSheet.assets[0].total);
    expect(r.balanceSheet.totalLiabilities).toBe(0);
  });

  it("is NOT truncated where the in-memory version was", async () => {
    const page = await newestPage();
    const old = computeReports(
      page.map((t) => ({ date: t.date, amountCents: t.amountCents, categoryName: t.category?.name ?? null, vertical: t.vertical })),
      YEAR_2025
    );
    const now = await computeReportsFromDb(companyId, YEAR_2025);
    // The old cash figure is short by exactly the rows that fell off the page.
    expect(old.balanceSheet.totalAssets).toBeLessThan(now.balanceSheet.totalAssets);
  });
});

describe("per-job activity", () => {
  it("rolls up the whole ledger, not the page", async () => {
    const jobs = await jobActivityFromDb(companyId);
    const job = jobs.get(projectId)!;
    expect(job.count).toBe(OLD_ROWS + NEW_ROWS);
    expect(job.in).toBe(450 * 10_000 + NEW_ROWS * 25_000);
    expect(job.out).toBe(450 * 4_000);
  });
});

describe("company isolation", () => {
  it("never counts another company's ledger", async () => {
    const other = await db.company.create({
      data: { name: "Other Co", slug: `other-${process.pid}-${Date.now()}` },
    });
    await db.transaction.create({
      data: { companyId: other.id, date: new Date(Date.UTC(2023, 5, 1)), description: "theirs", amountCents: 99_999_999 },
    });

    const mine = await computeReportsFromDb(companyId, YEAR_2023);
    expect(mine.pnl.totalIncome).toBe(450 * 10_000); // unchanged
    const theirs = await computeReportsFromDb(other.id, YEAR_2023);
    expect(theirs.pnl.totalIncome).toBe(99_999_999);

    await db.company.deleteMany({ where: { id: other.id } });
  });
});

describe("period boundaries", () => {
  it("includes a transaction dated exactly on each bound", async () => {
    const edge = await db.company.create({
      data: { name: "Edge Co", slug: `edge-${process.pid}-${Date.now()}` },
    });
    const start = Date.UTC(2024, 0, 1, 0, 0, 0, 0);
    const end = Date.UTC(2024, 11, 31, 23, 59, 59, 999);
    await db.transaction.createMany({
      data: [
        { companyId: edge.id, date: new Date(start), description: "first instant", amountCents: 1_000 },
        { companyId: edge.id, date: new Date(end), description: "last instant", amountCents: 2_000 },
        { companyId: edge.id, date: new Date(start - 1), description: "one ms early", amountCents: 4_000 },
        { companyId: edge.id, date: new Date(end + 1), description: "one ms late", amountCents: 8_000 },
      ],
    });

    const r = await computeReportsFromDb(edge.id, { startMs: start, endMs: end });
    // Inclusive on both ends, exclusive either side of them.
    expect(r.pnl.totalIncome).toBe(3_000);
    // The snapshot takes everything up to and including the end.
    expect(r.balanceSheet.totalAssets).toBe(1_000 + 2_000 + 4_000);

    await db.company.deleteMany({ where: { id: edge.id } });
  });

  it("treats an open-ended period as unbounded on that side", async () => {
    const onlyEnd = await computeReportsFromDb(companyId, { startMs: null, endMs: YEAR_2023.endMs });
    expect(onlyEnd.pnl.totalIncome).toBe(450 * 10_000);
    const onlyStart = await computeReportsFromDb(companyId, { startMs: YEAR_2025.startMs, endMs: null });
    expect(onlyStart.pnl.totalIncome).toBe(NEW_ROWS * 25_000);
  });
});

describe("the two implementations agree on a small ledger", () => {
  it("matches computeReports exactly when nothing is truncated", async () => {
    // The client still recomputes locally while its page IS the whole ledger,
    // so the two must produce identical statements in that case.
    const small = await db.company.create({
      data: { name: "Small Co", slug: `small-${process.pid}-${Date.now()}` },
    });
    const cat = await db.bookkeepingCategory.create({
      data: { companyId: small.id, name: "Consulting", type: "income" },
    });
    await db.transaction.createMany({
      data: [
        { companyId: small.id, date: new Date(Date.UTC(2025, 2, 3)), description: "a", amountCents: 5_000, categoryId: cat.id, vertical: "solar" },
        { companyId: small.id, date: new Date(Date.UTC(2025, 3, 4)), description: "b", amountCents: -1_500, categoryId: cat.id, vertical: "solar" },
        { companyId: small.id, date: new Date(Date.UTC(2025, 4, 5)), description: "c", amountCents: 2_250 },
      ],
    });

    const page = await db.transaction.findMany({
      where: { companyId: small.id },
      orderBy: { date: "desc" },
      select: { date: true, amountCents: true, vertical: true, category: { select: { name: true } } },
    });
    const local = computeReports(
      page.map((t) => ({ date: t.date, amountCents: t.amountCents, categoryName: t.category?.name ?? null, vertical: t.vertical })),
      YEAR_2025
    );
    const server = await computeReportsFromDb(small.id, YEAR_2025);

    expect(server.pnl.totalIncome).toBe(local.pnl.totalIncome);
    expect(server.pnl.totalExpense).toBe(local.pnl.totalExpense);
    expect(server.pnl.netProfit).toBe(local.pnl.netProfit);
    expect(server.pnl.income).toEqual(local.pnl.income);
    expect(server.pnl.expense).toEqual(local.pnl.expense);
    expect(server.balanceSheet).toEqual(local.balanceSheet);
    expect([...server.pnl.segments].sort((a, b) => a.vertical.localeCompare(b.vertical))).toEqual(
      [...local.pnl.segments].sort((a, b) => a.vertical.localeCompare(b.vertical))
    );

    await db.company.deleteMany({ where: { id: small.id } });
  });
});
