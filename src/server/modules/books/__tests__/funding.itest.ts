import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { accountBalances, trialBalance } from "../reports";
import {
  fundingCandidatesFor,
  fundingPlanFor,
  recogniseFunding,
  syncExpectedFundings,
} from "../funding";

/**
 * LENDER FUNDING.
 *
 * ── THE ASSERTION THIS FILE EXISTS FOR ──────────────────────────────────────
 * `dealerFeePct` is stored as 0–100. A 25% fee is `25`, not `0.25`, and
 * `solar-money.ts` is the authority (`rawPct / 100`). The first version of
 * funding.ts multiplied by it directly, which turned a $40,000 contract's fee
 * into $1,000,000 and its funding expectation into MINUS $960,000.
 *
 * A test written to the same wrong assumption would have passed against that
 * code and locked the error in, so the convention is asserted explicitly and
 * from both sides: `25` means a quarter, and `0.25` means a quarter of one
 * percent. Neither reading is inferable from the column, which is a bare Float.
 *
 * ── A THING THESE TESTS SHOW THAT IS NOT A BUG ──────────────────────────────
 * Recognising a deposit CREDITS Accounts Receivable, and nothing debits it yet
 * — posting an invoice to A/R is the remaining Phase 4 slice. So in isolation
 * A/R goes negative here. That is the ledger telling the truth about a half
 * built feature rather than a fault in either half, and the tests assert the
 * ENTRY BALANCES rather than pretending the A/R balance is meaningful yet.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let bankId: string;
let varianceId: string;
let dealerFeesId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });
const systemActor = () => ({ kind: "system" as const, label: "bank-feed auto-funding" });

const DAY = new Date("2026-07-15T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Funding Co", slug: `fnd-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
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
  varianceId = (await systemAccountId(companyId, "funding_variance"))!;
  dealerFeesId = (await systemAccountId(companyId, "dealer_fees"))!;
});

afterAll(async () => {
  await db.$disconnect();
});

/** A financed deal with a lender that funds 60/40 net of a 25% fee. */
async function aFinancedDeal(over?: {
  contractPriceCents?: number;
  dealerFeePct?: number;
  fundsNetOfDealerFee?: boolean;
  fundingM1Pct?: number | null;
  fundingM2Pct?: number | null;
  product?: "cash" | "loan";
  withLenderProduct?: boolean;
}) {
  const lender = await db.solarLender.create({
    data: {
      companyId,
      // Unique per call: `solar_lenders` has a unique index on
      // (companyId, lower(name)), so a fixed name means the second deal in a
      // test cannot be created at all.
      name: `Acme Capital ${Math.random().toString(36).slice(2, 9)}`,
      fundsNetOfDealerFee: over?.fundsNetOfDealerFee ?? true,
      fundingM1Pct: over?.fundingM1Pct === undefined ? 0.6 : over.fundingM1Pct,
      fundingM2Pct: over?.fundingM2Pct === undefined ? 0.4 : over.fundingM2Pct,
    },
  });
  const product = await db.solarLenderProduct.create({
    data: { companyId, lenderId: lender.id, product: over?.product ?? "loan" },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Dana", lastName: "Homeowner" },
  });
  await db.solarFinance.create({
    data: {
      companyId,
      leadId: lead.id,
      vertical: "solar",
      product: over?.product ?? "loan",
      contractPriceCents: over?.contractPriceCents ?? 4_000_000,
      dealerFeePct: over?.dealerFeePct ?? 25,
      lenderProductId: over?.withLenderProduct === false ? null : product.id,
    },
  });
  return { leadId: lead.id, lenderId: lender.id };
}

const balanceOf = async (accountId: string) =>
  (await accountBalances({ companyId, period: YEAR })).find((r) => r.accountId === accountId)?.balanceCents ?? 0;

describe("the funding plan", () => {
  /** THE PIN. 25 means a quarter. */
  it("reads dealerFeePct as 0–100, so 25 is a quarter of the contract", async () => {
    const { leadId } = await aFinancedDeal({ contractPriceCents: 4_000_000, dealerFeePct: 25 });
    const plan = await fundingPlanFor(companyId, leadId);
    if (!plan.ok) throw new Error(plan.reason);

    expect(plan.netCents).toBe(3_000_000);
    expect(plan.milestones).toEqual([
      { milestone: "m1", expectedCents: 1_800_000 },
      { milestone: "m2", expectedCents: 1_200_000 },
    ]);
  });

  /** The other side of the same pin: 0.25 is a quarter of ONE PERCENT. */
  it("treats 0.25 as a quarter of one percent, not as a quarter", async () => {
    const { leadId } = await aFinancedDeal({ contractPriceCents: 4_000_000, dealerFeePct: 0.25 });
    const plan = await fundingPlanFor(companyId, leadId);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.netCents).toBe(3_990_000);
  });

  /** A fee at or above 100% has no honest gross-up; the pricing code stands it down. */
  it("stands down a fee of 100 or more rather than emitting a negative expectation", async () => {
    const { leadId } = await aFinancedDeal({ contractPriceCents: 4_000_000, dealerFeePct: 100 });
    const plan = await fundingPlanFor(companyId, leadId);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.netCents).toBe(4_000_000);
  });

  it("funds the gross when the lender does not net its fee", async () => {
    const { leadId } = await aFinancedDeal({ fundsNetOfDealerFee: false });
    const plan = await fundingPlanFor(companyId, leadId);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.netCents).toBe(4_000_000);
  });

  /**
   * 50% + 50% of an odd number of cents does not come back to the number.
   * Without the drift correction a deal sits permanently one cent short.
   */
  it("gives the rounding remainder to the last milestone", async () => {
    const { leadId } = await aFinancedDeal({
      contractPriceCents: 101,
      dealerFeePct: 0,
      fundingM1Pct: 0.5,
      fundingM2Pct: 0.5,
    });
    const plan = await fundingPlanFor(companyId, leadId);
    if (!plan.ok) throw new Error(plan.reason);
    expect(plan.milestones.map((m) => m.expectedCents)).toEqual([51, 50]);
    expect(plan.milestones.reduce((s, m) => s + m.expectedCents, 0)).toBe(101);
  });

  it("refuses a cash deal, which the customer pays", async () => {
    const { leadId } = await aFinancedDeal({ product: "cash" });
    const plan = await fundingPlanFor(companyId, leadId);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("cash deal");
  });

  it("refuses a deal with no lender product chosen", async () => {
    const { leadId } = await aFinancedDeal({ withLenderProduct: false });
    const plan = await fundingPlanFor(companyId, leadId);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("No lender product");
  });

  /** Null everywhere means no expectation is formed — deposits go in by hand. */
  it("forms no expectation for a lender with no schedule", async () => {
    const { leadId } = await aFinancedDeal({ fundingM1Pct: null, fundingM2Pct: null });
    const plan = await fundingPlanFor(companyId, leadId);
    expect(plan.ok).toBe(false);
    if (!plan.ok) expect(plan.reason).toContain("no funding schedule");
  });
});

describe("writing the expectations", () => {
  it("opens one row per milestone", async () => {
    const { leadId } = await aFinancedDeal();
    const res = await syncExpectedFundings({ companyId, leadId });
    expect(res).toMatchObject({ ok: true, written: 2, skipped: 0 });

    const rows = await db.lenderFunding.findMany({ where: { companyId, leadId }, orderBy: { milestone: "asc" } });
    expect(rows.map((r) => r.expectedCents)).toEqual([1_800_000, 1_200_000]);
  });

  it("re-running updates rather than opening a second expectation", async () => {
    const { leadId } = await aFinancedDeal();
    await syncExpectedFundings({ companyId, leadId });
    await db.solarFinance.update({ where: { leadId }, data: { contractPriceCents: 2_000_000 } });
    await syncExpectedFundings({ companyId, leadId });

    const rows = await db.lenderFunding.findMany({ where: { companyId, leadId } });
    expect(rows).toHaveLength(2);
    expect(rows.reduce((s, r) => s + r.expectedCents, 0)).toBe(1_500_000);
  });

  /** Re-baselining a settled row would erase the variance that was recorded. */
  it("leaves a milestone that has already been received alone", async () => {
    const { leadId } = await aFinancedDeal();
    await syncExpectedFundings({ companyId, leadId });
    const m1 = await db.lenderFunding.findFirstOrThrow({ where: { companyId, leadId, milestone: "m1" } });
    await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });

    await db.solarFinance.update({ where: { leadId }, data: { contractPriceCents: 2_000_000 } });
    const res = await syncExpectedFundings({ companyId, leadId });
    expect(res).toMatchObject({ ok: true, written: 1, skipped: 1 });

    const reread = await db.lenderFunding.findUniqueOrThrow({ where: { id: m1.id } });
    expect(reread.expectedCents).toBe(1_800_000);
  });
});

describe("recognising a deposit", () => {
  async function anM1(over?: Parameters<typeof aFinancedDeal>[0]) {
    const { leadId } = await aFinancedDeal(over);
    await syncExpectedFundings({ companyId, leadId });
    return db.lenderFunding.findFirstOrThrow({ where: { companyId, leadId, milestone: "m1" } });
  }

  it("books an exact deposit with no variance line, and balances", async () => {
    const m1 = await anM1();
    const res = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });
    expect(res).toMatchObject({ ok: true, varianceCents: 0, status: "received" });

    expect(await balanceOf(bankId)).toBe(1_800_000);
    expect(await balanceOf(varianceId)).toBe(0);
    expect((await trialBalance(companyId)).balanced).toBe(true);

    if (res.ok) {
      const entry = await db.journalEntry.findUniqueOrThrow({
        where: { id: res.entryId }, select: { lines: true, sourceType: true, sourceId: true },
      });
      expect(entry.lines).toHaveLength(2);
      expect(entry.sourceType).toBe("funding");
      expect(entry.sourceId).toBe(`funding:${m1.id}`);
    }
  });

  it("puts a SHORT deposit's gap in Funding Variance", async () => {
    const m1 = await anM1();
    const res = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_750_000, date: DAY, actor: actor(),
    });
    expect(res).toMatchObject({ ok: true, varianceCents: -50_000, status: "short" });

    // An expense's normal balance is a debit, so a positive figure is a cost.
    expect(await balanceOf(varianceId)).toBe(50_000);
    expect(await balanceOf(bankId)).toBe(1_750_000);
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  it("puts an OVER deposit's surplus in Funding Variance too", async () => {
    const m1 = await anM1();
    const res = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_830_000, date: DAY, actor: actor(),
    });
    expect(res).toMatchObject({ ok: true, varianceCents: 30_000, status: "over" });
    expect(await balanceOf(varianceId)).toBe(-30_000);
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  /**
   * When the lender was expected to fund GROSS, the shortfall IS the dealer fee
   * by construction — so it belongs in Dealer Fees, not in the variance account
   * that means "we cannot explain this".
   */
  it("routes the gap to Dealer Fees when the lender funds gross", async () => {
    const m1 = await anM1({ fundsNetOfDealerFee: false });
    // Gross 4,000,000 × 0.6 = 2,400,000 expected; the lender keeps its 25%.
    await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });

    expect(await balanceOf(dealerFeesId)).toBe(600_000);
    expect(await balanceOf(varianceId)).toBe(0);
    expect((await trialBalance(companyId)).balanced).toBe(true);
  });

  it("records the evidence and will not book the same deposit twice", async () => {
    const m1 = await anM1();
    const first = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });
    expect(first.ok).toBe(true);

    const again = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toContain("already been recorded");

    const row = await db.lenderFunding.findUniqueOrThrow({ where: { id: m1.id } });
    expect(row.journalEntryId).not.toBeNull();
    expect(row.receivedAt?.toISOString()).toBe(DAY.toISOString());
  });

  /** Auto-funding runs as the system, and the ledger records that. */
  it("accepts a system actor, leaving no user on the decision", async () => {
    const m1 = await anM1();
    const res = await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: systemActor(),
    });
    expect(res.ok).toBe(true);

    const row = await db.lenderFunding.findUniqueOrThrow({ where: { id: m1.id } });
    expect(row.decidedById).toBeNull();
    expect(row.decidedAt).not.toBeNull();
  });

  it("refuses a deposit that is not a positive whole number of cents", async () => {
    const m1 = await anM1();
    for (const bad of [0, -100, 12.5]) {
      const res = await recogniseFunding({
        companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
        receivedCents: bad, date: DAY, actor: actor(),
      });
      expect(res.ok, `${bad} should be refused`).toBe(false);
    }
  });

  it("refuses a funding belonging to another company", async () => {
    const m1 = await anM1();
    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${Math.random().toString(36).slice(2, 7)}` },
    });
    const res = await recogniseFunding({
      companyId: other.id, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });
    expect(res.ok).toBe(false);
  });
});

describe("matching a deposit to an expectation", () => {
  it("matches on exact cents when no tolerance is configured", async () => {
    const { leadId } = await aFinancedDeal();
    await syncExpectedFundings({ companyId, leadId });

    expect(await fundingCandidatesFor({ companyId, amountCents: 1_800_000 })).toHaveLength(1);
    // One cent out, and a lender nobody has measured is not auto-matched.
    expect(await fundingCandidatesFor({ companyId, amountCents: 1_799_999 })).toHaveLength(0);
  });

  it("widens to the lender's tolerance once it is configured", async () => {
    const { leadId, lenderId } = await aFinancedDeal();
    await db.solarLender.update({ where: { id: lenderId }, data: { fundingToleranceCents: 5_000 } });
    await syncExpectedFundings({ companyId, leadId });

    expect(await fundingCandidatesFor({ companyId, amountCents: 1_797_000 })).toHaveLength(1);
    expect(await fundingCandidatesFor({ companyId, amountCents: 1_790_000 })).toHaveLength(0);
  });

  /**
   * Returning every candidate is the point: the caller auto-posts only when
   * there is exactly one, and a list of two is the signal to ask a person.
   */
  it("returns BOTH when two deals expect the same amount", async () => {
    const a = await aFinancedDeal();
    const b = await aFinancedDeal();
    await syncExpectedFundings({ companyId, leadId: a.leadId });
    await syncExpectedFundings({ companyId, leadId: b.leadId });

    expect(await fundingCandidatesFor({ companyId, amountCents: 1_800_000 })).toHaveLength(2);
  });

  it("ignores milestones that have already been settled", async () => {
    const { leadId } = await aFinancedDeal();
    await syncExpectedFundings({ companyId, leadId });
    const m1 = await db.lenderFunding.findFirstOrThrow({ where: { companyId, leadId, milestone: "m1" } });
    await recogniseFunding({
      companyId, fundingId: m1.id, bankLedgerAccountId: bankId,
      receivedCents: 1_800_000, date: DAY, actor: actor(),
    });

    expect(await fundingCandidatesFor({ companyId, amountCents: 1_800_000 })).toHaveLength(0);
  });
});
