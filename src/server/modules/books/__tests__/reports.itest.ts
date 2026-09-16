import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { postJournalEntry, voidJournalEntry } from "../posting";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import {
  trialBalance,
  profitAndLoss,
  profitAndLossByVertical,
  balanceSheet,
  generalLedger,
} from "../reports";

/**
 * THE STATEMENTS, CHECKED AGAINST ARITHMETIC THAT CANNOT BE ARGUED WITH.
 *
 * Three properties carry the rest:
 *
 *   1. the trial balance balances — if it ever does not, something wrote
 *      journal_lines without going through the posting service;
 *   2. A = L + E, including net income that has not been closed yet, which is
 *      the part a naive balance sheet gets wrong;
 *   3. a VOID entry contributes nothing, because its reversal already cancels
 *      it — subtracting the original as well would double-count the fix.
 *
 * And one deliberate non-property: the two department P&Ls do NOT sum to the
 * combined P&L. The difference is company-level overhead, which belongs to
 * neither department, and a test that demanded they add up would be demanding
 * the reports lie.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankId: string;
let roofRevenueId: string;
let solarRevenueId: string;
let materialsId: string;
let rentId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const JAN = new Date("2026-01-15T12:00:00Z");
const FEB = new Date("2026-02-15T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
const AS_OF = new Date("2026-12-31T23:59:59Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Reports Co", slug: `rep-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `o-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  await ensureChartOfAccounts(companyId);
  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1010" } })).id;
  roofRevenueId = (await systemAccountId(companyId, "roofing_revenue"))!;
  solarRevenueId = (await systemAccountId(companyId, "solar_revenue"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;
  rentId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "6400" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

/** A roofing sale, a solar sale, materials on each, and untagged office rent. */
async function bookAYear() {
  await postJournalEntry({
    companyId, date: JAN, memo: "Roofing job", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: bankId, debitCents: 500_000, vertical: "roofing" },
      { accountId: roofRevenueId, creditCents: 500_000, vertical: "roofing" },
    ],
  });
  await postJournalEntry({
    companyId, date: JAN, memo: "Solar job", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: bankId, debitCents: 800_000, vertical: "solar" },
      { accountId: solarRevenueId, creditCents: 800_000, vertical: "solar" },
    ],
  });
  await postJournalEntry({
    companyId, date: FEB, memo: "Materials", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: materialsId, debitCents: 150_000, vertical: "roofing" },
      { accountId: materialsId, debitCents: 250_000, vertical: "solar" },
      { accountId: bankId, creditCents: 400_000 },
    ],
  });
  // Belongs to NEITHER department.
  await postJournalEntry({
    companyId, date: FEB, memo: "Office rent", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: rentId, debitCents: 100_000 },
      { accountId: bankId, creditCents: 100_000 },
    ],
  });
}

describe("the trial balance checks the ledger", () => {
  it("balances, and its rows are signed in each account's normal direction", async () => {
    await bookAYear();
    const tb = await trialBalance(companyId, AS_OF);

    expect(tb.balanced).toBe(true);
    expect(tb.totalDebitsCents).toBe(tb.totalCreditsCents);

    const revenue = tb.rows.find((r) => r.accountId === roofRevenueId)!;
    expect(revenue.balanceCents).toBe(500_000); // credit-normal, reported positive
    const materials = tb.rows.find((r) => r.accountId === materialsId)!;
    expect(materials.balanceCents).toBe(400_000); // debit-normal, also positive
  });

  it("still balances after a void, counting the pair exactly once", async () => {
    await bookAYear();
    const extra = await postJournalEntry({
      companyId, date: FEB, memo: "Mistake", sourceType: "manual", actor: actor(),
      lines: [
        { accountId: bankId, debitCents: 999_00, vertical: "solar" },
        { accountId: solarRevenueId, creditCents: 999_00, vertical: "solar" },
      ],
    });
    if (!extra.ok) throw new Error("setup");

    const before = await profitAndLoss({ companyId, period: YEAR });
    expect(before.income.totalCents).toBe(500_000 + 800_000 + 999_00);

    await voidJournalEntry({ companyId, entryId: extra.entryId, reason: "wrong deal", actor: actor() });

    const after = await profitAndLoss({ companyId, period: YEAR });
    // Back to exactly where it was — not half, not double.
    expect(after.income.totalCents).toBe(500_000 + 800_000);
    expect((await trialBalance(companyId, AS_OF)).balanced).toBe(true);
  });
});

describe("the profit and loss", () => {
  it("runs income − cogs − expenses down to net income", async () => {
    await bookAYear();
    const pnl = await profitAndLoss({ companyId, period: YEAR });

    expect(pnl.income.totalCents).toBe(1_300_000);
    expect(pnl.cogs.totalCents).toBe(400_000);
    expect(pnl.grossProfitCents).toBe(900_000);
    expect(pnl.expenses.totalCents).toBe(100_000); // rent
    expect(pnl.operatingIncomeCents).toBe(800_000);
    expect(pnl.netIncomeCents).toBe(800_000);
  });

  it("carries no balance-sheet account onto the P&L", async () => {
    await bookAYear();
    const pnl = await profitAndLoss({ companyId, period: YEAR });
    const all = [...pnl.income.rows, ...pnl.cogs.rows, ...pnl.expenses.rows];
    expect(all.some((r) => r.accountId === bankId)).toBe(false);
  });

  it("reports a period below the cut correctly, not as zero", async () => {
    await bookAYear();
    const january = await profitAndLoss({
      companyId,
      period: { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 0, 31, 23, 59, 59, 999) },
    });
    expect(january.income.totalCents).toBe(1_300_000);
    expect(january.cogs.totalCents).toBe(0); // materials were February
  });
});

describe("the department split", () => {
  it("gives each vertical only its own lines", async () => {
    await bookAYear();
    const { combined, byVertical } = await profitAndLossByVertical({
      companyId, period: YEAR, verticals: ["roofing", "solar"],
    });

    const roofing = byVertical.find((v) => v.vertical === "roofing")!.pnl;
    const solar = byVertical.find((v) => v.vertical === "solar")!.pnl;

    expect(roofing.income.totalCents).toBe(500_000);
    expect(roofing.cogs.totalCents).toBe(150_000);
    expect(solar.income.totalCents).toBe(800_000);
    expect(solar.cogs.totalCents).toBe(250_000);
    expect(combined.income.totalCents).toBe(1_300_000);
  });

  it("DOES NOT sum to the combined P&L, and the gap is company overhead", async () => {
    // The deliberate non-property. Office rent belongs to neither department,
    // so folding it into one — or splitting it — would make both wrong.
    await bookAYear();
    const { combined, byVertical } = await profitAndLossByVertical({
      companyId, period: YEAR, verticals: ["roofing", "solar"],
    });

    const departmentNet = byVertical.reduce((s, v) => s + v.pnl.netIncomeCents, 0);
    expect(departmentNet).toBe(900_000);
    expect(combined.netIncomeCents).toBe(800_000);
    expect(departmentNet - combined.netIncomeCents).toBe(100_000); // the rent
  });
});

describe("the balance sheet", () => {
  it("balances: A = L + E, with this year's profit in equity", async () => {
    await bookAYear();
    const bs = await balanceSheet({ companyId, asOf: AS_OF });

    // Cash: 500k + 800k in, 400k + 100k out.
    expect(bs.totalAssetsCents).toBe(800_000);
    expect(bs.totalLiabilitiesCents).toBe(0);
    // Nothing is closed yet, so equity IS the year's net income.
    expect(bs.netIncomeCents).toBe(800_000);
    expect(bs.totalEquityCents).toBe(800_000);
    expect(bs.balanced).toBe(true);
    expect(bs.totalAssetsCents).toBe(bs.totalLiabilitiesCents + bs.totalEquityCents);
  });

  it("balances with a liability on the books too", async () => {
    await bookAYear();
    const payable = (await systemAccountId(companyId, "commissions_payable"))!;
    await postJournalEntry({
      companyId, date: FEB, memo: "Commission accrued", sourceType: "manual", actor: actor(),
      lines: [
        { accountId: (await systemAccountId(companyId, "commissions_expense"))!, debitCents: 120_000, vertical: "solar" },
        { accountId: payable, creditCents: 120_000 },
      ],
    });

    const bs = await balanceSheet({ companyId, asOf: AS_OF });
    expect(bs.totalLiabilitiesCents).toBe(120_000);
    expect(bs.netIncomeCents).toBe(800_000 - 120_000);
    expect(bs.balanced).toBe(true);
  });

  it("is a snapshot: everything through the date, with no lower bound", async () => {
    await bookAYear();
    const throughJan = await balanceSheet({ companyId, asOf: new Date("2026-01-31T23:59:59Z") });
    // February's spending has not happened yet.
    expect(throughJan.totalAssetsCents).toBe(1_300_000);
    expect(throughJan.balanced).toBe(true);
  });
});

describe("the general ledger drill-down", () => {
  it("runs a balance down the account and marks a void without counting it", async () => {
    const posted = await postJournalEntry({
      companyId, date: JAN, memo: "Sale", sourceType: "manual", actor: actor(),
      lines: [
        { accountId: bankId, debitCents: 100_000, vertical: "roofing" },
        { accountId: roofRevenueId, creditCents: 100_000, vertical: "roofing" },
      ],
    });
    if (!posted.ok) throw new Error("setup");
    await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "duplicate", actor: actor() });

    const rows = await generalLedger({ companyId, accountId: bankId });
    // Two lines: the original (now marked void), and its reversal.
    expect(rows).toHaveLength(2);
    expect(rows.some((r) => r.status === "void")).toBe(true);
    // BOTH count. The original takes the account to +100,000 and the reversal
    // brings it back to nothing — which is what a correction looks like in a
    // ledger you are not allowed to delete from.
    expect(rows[0].runningCents).toBe(100_000);
    expect(rows[rows.length - 1].runningCents).toBe(0);
  });

  it("carries the vendor and the job onto each row", async () => {
    const vendor = await db.bookkeepingVendor.create({ data: { companyId, name: "Acme Supply" } });
    await postJournalEntry({
      companyId, date: FEB, memo: "Materials", sourceType: "manual", actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 50_000, vendorId: vendor.id, vertical: "roofing" },
        { accountId: bankId, creditCents: 50_000 },
      ],
    });
    const rows = await generalLedger({ companyId, accountId: materialsId });
    expect(rows[0].vendorName).toBe("Acme Supply");
    expect(rows[0].vertical).toBe("roofing");
  });
});
