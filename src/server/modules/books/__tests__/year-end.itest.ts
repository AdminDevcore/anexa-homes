import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { postJournalEntry } from "../posting";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { balanceSheet, profitAndLoss } from "../reports";
import { closableYears, closeFiscalYear, existingClose, reopenFiscalYear } from "../year-end";

/**
 * THE YEAR-END CLOSE.
 *
 * The property that matters most is the counter-intuitive one: closing a year
 * must leave TOTAL EQUITY EXACTLY WHERE IT WAS. The balance sheet already
 * reports current-year profit as its own equity line, because the income and
 * expense accounts are not closed yet — so the close moves a figure from one
 * equity line to another and the company is worth the same afterwards. If
 * total equity moves when a year is closed, the close is double-counting.
 *
 * The rest: it empties the P&L, it happens once, only the owner may do it, and
 * reopening is a reversal rather than a deletion.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankId: string;
let roofRevenueId: string;
let materialsId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });
const bookkeeper = () => ({ kind: "user" as const, userId: ownerId, role: "accounting" as const });

const JUN = new Date("2026-06-15T12:00:00Z");
const DEC31 = new Date("2026-12-31T23:59:59Z");

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Close Co", slug: `cls-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
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
  materialsId = (await systemAccountId(companyId, "materials"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

/** $4,000.00 earned, $1,500.00 spent — a $2,500.00 year. */
async function aProfitableYear() {
  await postJournalEntry({
    companyId, date: JUN, memo: "Sale", sourceType: "manual", actor: owner(),
    lines: [
      { accountId: bankId, debitCents: 400_000, vertical: "roofing" },
      { accountId: roofRevenueId, creditCents: 400_000, vertical: "roofing" },
    ],
  });
  await postJournalEntry({
    companyId, date: JUN, memo: "Materials", sourceType: "manual", actor: owner(),
    lines: [
      { accountId: materialsId, debitCents: 150_000, vertical: "roofing" },
      { accountId: bankId, creditCents: 150_000 },
    ],
  });
}

describe("closing a year", () => {
  it("leaves total equity exactly where it was", async () => {
    await aProfitableYear();
    const before = await balanceSheet({ companyId, asOf: DEC31 });

    const res = await closeFiscalYear({ companyId, year: 2026, actor: owner() });
    expect(res.ok).toBe(true);

    const after = await balanceSheet({ companyId, asOf: DEC31 });
    expect(after.totalEquityCents).toBe(before.totalEquityCents);
    expect(after.totalAssetsCents).toBe(before.totalAssetsCents);
    expect(after.balanced).toBe(true);
  });

  it("empties the profit and loss for the closed year", async () => {
    await aProfitableYear();
    const year = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

    const before = await profitAndLoss({ companyId, period: year });
    expect(before.netIncomeCents).toBe(250_000);

    await closeFiscalYear({ companyId, year: 2026, actor: owner() });

    const after = await profitAndLoss({ companyId, period: year });
    expect(after.income.totalCents).toBe(0);
    expect(after.cogs.totalCents).toBe(0);
    expect(after.netIncomeCents).toBe(0);
  });

  it("reports what it did", async () => {
    await aProfitableYear();
    const res = await closeFiscalYear({ companyId, year: 2026, actor: owner() });
    if (!res.ok) throw new Error(res.error);
    expect(res.netIncomeCents).toBe(250_000);
    expect(res.accountsClosed).toBe(2);
  });

  /** Pressing the button twice is not two closes. */
  it("refuses to close the same year again", async () => {
    await aProfitableYear();
    expect((await closeFiscalYear({ companyId, year: 2026, actor: owner() })).ok).toBe(true);

    const second = await closeFiscalYear({ companyId, year: 2026, actor: owner() });
    expect(second.ok).toBe(false);
    if (!second.ok) expect(second.error).toContain("already closed");
  });

  it("is the owner's decision alone", async () => {
    await aProfitableYear();
    const res = await closeFiscalYear({ companyId, year: 2026, actor: bookkeeper() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("owner");
    expect(await existingClose(companyId, 2026)).toBeNull();
  });

  it("declines a year with nothing in it rather than posting an empty entry", async () => {
    const res = await closeFiscalYear({ companyId, year: 2019, actor: owner() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("Nothing to close");
  });

  /**
   * A contra year: more refunded than sold, so the income account's balance is
   * NEGATIVE in its normal direction. Assuming the sign is how a naive close
   * posts a negative debit and is rejected by the posting service.
   */
  it("closes an account whose balance sits on the wrong side", async () => {
    await postJournalEntry({
      companyId, date: JUN, memo: "Refund exceeding sales", sourceType: "manual", actor: owner(),
      lines: [
        { accountId: roofRevenueId, debitCents: 75_000, vertical: "roofing" },
        { accountId: bankId, creditCents: 75_000 },
      ],
    });

    const res = await closeFiscalYear({ companyId, year: 2026, actor: owner() });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.netIncomeCents).toBe(-75_000);

    const year = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
    expect((await profitAndLoss({ companyId, period: year })).netIncomeCents).toBe(0);
  });
});

describe("reopening a year", () => {
  it("reverses the close rather than deleting it, and the profit comes back", async () => {
    await aProfitableYear();
    await closeFiscalYear({ companyId, year: 2026, actor: owner() });

    const res = await reopenFiscalYear({ companyId, year: 2026, reason: "late invoice", actor: owner() });
    expect(res.ok).toBe(true);

    const year = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };
    expect((await profitAndLoss({ companyId, period: year })).netIncomeCents).toBe(250_000);

    // The close is gone as a POSTED entry, but nothing was deleted: the
    // original remains, marked void, and the reversal points back at it. An
    // auditor can see the year was closed and later reopened.
    //
    // Asserted through `reversesId` rather than by counting a sourceType,
    // because `voidJournalEntry` gives a reversal its OWN sourceType —
    // "year_end_close.reversal" — so a count of "year_end_close" finds one row
    // and says nothing about whether history survived.
    expect(await existingClose(companyId, 2026)).toBeNull();

    const entries = await db.journalEntry.findMany({
      where: { companyId, sourceType: { startsWith: "year_end_close" } },
      select: { id: true, sourceType: true, sourceId: true, status: true, reversesId: true },
    });
    expect(entries).toHaveLength(2);

    const original = entries.find((e) => e.sourceType === "year_end_close")!;
    const reversal = entries.find((e) => e.sourceType === "year_end_close.reversal")!;
    expect(original.status).toBe("void");
    expect(reversal.status).toBe("posted");
    expect(reversal.reversesId).toBe(original.id);
    // The reversal carries its own key, so it cannot be posted twice either.
    expect(reversal.sourceId).toBe("close:2026:reversal");
  });

  it("wants a reason, and is the owner's alone", async () => {
    await aProfitableYear();
    await closeFiscalYear({ companyId, year: 2026, actor: owner() });

    expect((await reopenFiscalYear({ companyId, year: 2026, reason: "  ", actor: owner() })).ok).toBe(false);
    expect((await reopenFiscalYear({ companyId, year: 2026, reason: "x", actor: bookkeeper() })).ok).toBe(false);
  });

  it("will not reopen a year that was never closed", async () => {
    const res = await reopenFiscalYear({ companyId, year: 2026, reason: "x", actor: owner() });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("not closed");
  });
});

describe("closableYears", () => {
  it("lists years with activity, newest first, marking the closed ones", async () => {
    await aProfitableYear();
    await closeFiscalYear({ companyId, year: 2026, actor: owner() });

    const years = await closableYears(companyId);
    expect(years.length).toBeGreaterThan(0);
    expect(years[0].year).toBe(2026);
    expect(years[0].closed).toBe(true);
    expect(years[0].closedOn).not.toBeNull();
  });

  it("is empty for a company that has never posted anything", async () => {
    expect(await closableYears(companyId)).toEqual([]);
  });
});
