import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { postJournalEntry, voidJournalEntry } from "../posting";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import {
  money,
  trialBalanceStatement,
  profitAndLossStatement,
  balanceSheetStatement,
  generalLedgerStatement,
  priorPeriod,
  priorYear,
} from "../statements";

/**
 * THE STATEMENTS AS A PERSON RECEIVES THEM.
 *
 * `reports.itest.ts` proves the arithmetic. This file proves the part that
 * arithmetic cannot: that the numbers survive the trip to the page, the CSV and
 * the PDF without being rounded, mislabelled or silently switched between
 * bases.
 *
 * Two properties carry most of it:
 *
 *   1. CENTS SURVIVE. Every money formatter already in this repo rounds to
 *      whole dollars, which would make a trial balance that balances print as
 *      though it does not.
 *   2. CASH AND ACCRUAL GENUINELY DIFFER, and differ by exactly the entries
 *      that never touched money — otherwise the toggle is decoration.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankId: string;
let arId: string;
let roofRevenueId: string;
let materialsId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const JAN = new Date("2026-01-15T12:00:00Z");
const FEB = new Date("2026-02-15T12:00:00Z");
const AS_OF = new Date("2026-12-31T23:59:59Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Statements Co", slug: `stm-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
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
  arId = (await systemAccountId(companyId, "accounts_receivable"))!;
  roofRevenueId = (await systemAccountId(companyId, "roofing_revenue"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

/** $1,234.56 paid in cash — deliberately not a round number of dollars. */
async function cashSale() {
  await postJournalEntry({
    companyId, date: JAN, memo: "Paid in cash", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: bankId, debitCents: 123_456, vertical: "roofing" },
      { accountId: roofRevenueId, creditCents: 123_456, vertical: "roofing" },
    ],
  });
}

/** $500.00 invoiced and NOT yet paid — income on accrual, invisible on cash. */
async function invoicedSale() {
  await postJournalEntry({
    companyId, date: JAN, memo: "Invoiced, unpaid", sourceType: "manual", actor: actor(),
    lines: [
      { accountId: arId, debitCents: 50_000, vertical: "roofing" },
      { accountId: roofRevenueId, creditCents: 50_000, vertical: "roofing" },
    ],
  });
}

describe("money", () => {
  /**
   * The bug this exists to prevent: `makeMoney` and every `usd()` in the
   * reports modules use maximumFractionDigits 0 / Math.round, so $1,234.56
   * prints as $1,235. On a trial balance that turns "balances" into "does not".
   */
  it("keeps the cents", () => {
    expect(money(123_456)).toBe("$1,234.56");
    expect(money(5)).toBe("$0.05");
    expect(money(0)).toBe("$0.00");
    expect(money(-123_456)).toBe("-$1,234.56");
  });

  it("does not drift on values a float would round badly", () => {
    // 0.1 + 0.2 territory: integer arithmetic must not go near it.
    expect(money(10 + 20)).toBe("$0.30");
    expect(money(99_999_999)).toBe("$999,999.99");
  });
});

describe("the trial balance statement", () => {
  it("prints cent-exact totals and says the ledger balances", async () => {
    await cashSale();
    const r = await trialBalanceStatement({ companyId, asOf: AS_OF });

    const debits = r.metrics.find((m) => m.label === "Total debits")!;
    const credits = r.metrics.find((m) => m.label === "Total credits")!;
    expect(debits.value).toBe("$1,234.56");
    expect(credits.value).toBe("$1,234.56");

    const balanced = r.metrics.find((m) => m.label === "Ledger balances")!;
    expect(balanced.value).toBe("Yes");
    expect(balanced.tone).toBe("pos");
  });

  /** It describes itself as accrual, because it has no other mode. */
  it("is labelled accrual and offers no basis", async () => {
    await cashSale();
    const r = await trialBalanceStatement({ companyId, asOf: AS_OF });
    expect(r.scopeLabel).toBe("Accrual basis");
  });
});

describe("cash basis versus accrual", () => {
  it("accrual counts the invoice; cash does not", async () => {
    await cashSale();
    await invoicedSale();

    const accrual = await profitAndLossStatement({ companyId, period: YEAR, basis: "accrual" });
    const cash = await profitAndLossStatement({ companyId, period: YEAR, basis: "cash" });

    // $1,234.56 + $500.00 = $1,734.56 on accrual; only the paid one on cash.
    expect(accrual.metrics.find((m) => m.label === "Income")!.value).toBe("$1,734.56");
    expect(cash.metrics.find((m) => m.label === "Income")!.value).toBe("$1,234.56");
  });

  it("says on its face which basis it used", async () => {
    await cashSale();
    const accrual = await profitAndLossStatement({ companyId, period: YEAR, basis: "accrual" });
    const cash = await profitAndLossStatement({ companyId, period: YEAR, basis: "cash" });
    expect(accrual.scopeLabel).toContain("Accrual basis");
    expect(cash.scopeLabel).toContain("Cash basis");
    expect(cash.tables[0].title).toContain("Cash basis");
  });

  /**
   * A credit card is NOT cash. Paying by card is borrowing, and treating it as
   * cash would let a cash-basis P&L book an expense that no money has left for.
   */
  it("does not treat a credit card as cash", async () => {
    const cardId = (await systemAccountId(companyId, "credit_cards"))!;
    await postJournalEntry({
      companyId, date: FEB, memo: "Materials on the card", sourceType: "manual", actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 30_000, vertical: "roofing" },
        { accountId: cardId, creditCents: 30_000 },
      ],
    });

    const cash = await profitAndLossStatement({ companyId, period: YEAR, basis: "cash" });
    expect(cash.metrics.find((m) => m.label === "Gross profit")!.value).toBe("$0.00");
  });
});

describe("the comparison column", () => {
  it("adds prior-period columns and the change between them", async () => {
    await cashSale(); // January
    const feb = { startMs: Date.UTC(2026, 1, 1), endMs: Date.UTC(2026, 1, 28, 23, 59, 59, 999) };

    const r = await profitAndLossStatement({ companyId, period: feb, comparison: "prior_period" });
    expect(r.tables[0].columns).toEqual(["Account", "Amount", "Comparison", "Change"]);
    expect(r.periodLabel).toContain("vs. previous period");
  });

  /**
   * An open-ended window has no previous period. Inventing one would put a
   * column of confident numbers beside a figure they do not correspond to.
   */
  it("refuses to invent a comparison for an unbounded period", () => {
    expect(priorPeriod({ startMs: null, endMs: null })).toBeNull();
    expect(priorPeriod(undefined)).toBeNull();
    expect(priorYear({ startMs: null, endMs: Date.now() })).toBeNull();
  });

  it("steps back exactly one calendar year", () => {
    const p = priorYear(YEAR)!;
    expect(new Date(p.startMs!).getUTCFullYear()).toBe(2025);
    expect(new Date(p.endMs!).getUTCFullYear()).toBe(2025);
  });
});

describe("the balance sheet statement", () => {
  it("balances, and shows this year's profit as unclosed equity", async () => {
    await cashSale();
    const r = await balanceSheetStatement({ companyId, asOf: AS_OF });

    expect(r.metrics.find((m) => m.label === "Balances (A = L + E)")!.value).toBe("Yes");
    const rows = r.tables[0].rows.map((x) => String(x[0]));
    expect(rows.some((t) => t.includes("not yet closed"))).toBe(true);
  });
});

describe("the general ledger statement", () => {
  it("marks a void and still runs the balance through it", async () => {
    await cashSale();
    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId }, orderBy: { createdAt: "desc" } });
    await voidJournalEntry({ companyId, entryId: entry.id, reason: "keyed twice", actor: actor() });

    const r = await generalLedgerStatement({
      companyId, accountId: roofRevenueId, accountLabel: "4000 Roofing Revenue", period: YEAR,
    });

    const memos = r.tables[0].rows.map((x) => String(x[1]));
    expect(memos.some((m) => m.startsWith("[VOID]"))).toBe(true);
    // The pair nets to nothing, so the account closes where it started.
    expect(r.metrics.find((m) => m.label === "Closing balance")!.value).toBe("$0.00");
  });
});
