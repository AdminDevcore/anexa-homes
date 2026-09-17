import type { FundingMilestone, FundingStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import { postJournalEntry, type JournalLineInput, type PostingActor } from "./posting";

/**
 * WHAT A LENDER OWES US ON A DEAL, AND WHAT ACTUALLY ARRIVED.
 *
 * A financed solar deal is not paid by the homeowner. It is paid by the lender,
 * net of the lender's dealer fee, usually in stages — and until this existed,
 * "we are owed $18,400 on that job" was something a person reconstructed from a
 * bank statement rather than something the books could state.
 *
 * ── THE EXPECTATION IS FORMED, NOT GUESSED ──────────────────────────────────
 * `SolarLender` carries the funding pattern, and every field of it defaults to
 * NULL. Null means NO EXPECTATION IS FORMED and deposits are decided by hand.
 * That is deliberate: inventing a schedule for a lender nobody configured would
 * produce confident "short by $4,200" figures about a lender whose terms we
 * never recorded, and a wrong number stated precisely is worse than no number.
 *
 * ── CASH DEALS FUND NOTHING ─────────────────────────────────────────────────
 * `FinanceProduct.cash` has no dealer fee and no lender, so it has no funding.
 * The schema documents that; this module enforces it rather than computing a
 * zero and leaving an empty expectation lying around.
 *
 * ── WHERE THE DIFFERENCE GOES ───────────────────────────────────────────────
 * A deposit rarely lands exactly on the expectation, and the difference is
 * posted rather than absorbed — absorbed into revenue, nobody would ever see it.
 * Which account it lands in is DERIVED from what the lender was expected to do:
 *
 *   fundsNetOfDealerFee = true   the fee was already excluded from the
 *                                expectation, so a remaining difference is
 *                                genuinely unexplained  →  Funding Variance
 *
 *   fundsNetOfDealerFee = false  the expectation was the GROSS contract, so the
 *                                shortfall IS the fee by construction
 *                                                        →  Dealer Fees
 *
 * That is a rule about the configuration, not a judgement about each deposit,
 * so it gives the same answer every time and can be read off the lender.
 *
 * ── WHY EVERY READ HERE IS UNSCOPED ─────────────────────────────────────────
 * `SolarFinance`, `SolarLenderProduct`, `SolarLender` and `Lead` are all
 * VERTICAL-SCOPED, and this module reads them through the extended client. The
 * books are not scoped — "one set of books, split by vertical" — so funding is
 * asked about from places that have no active workspace at all: the bank-feed
 * sweep, a webhook, the Books screen itself. Left scoped, every one of those
 * throws MissingVerticalContextError, which is how this was found.
 *
 * Unscoping is correct rather than merely convenient: a deposit is recognised
 * against the deal that earned it, and which workspace the viewer happens to
 * have toggled has nothing to do with which lender wired which job. Every call
 * still filters by `companyId`, which is the boundary that actually matters.
 */

export type ExpectedFunding = {
  milestone: FundingMilestone;
  expectedCents: number;
};

export type FundingPlan =
  | { ok: true; lenderId: string; netCents: number; dealerFeePct: number; milestones: ExpectedFunding[] }
  | { ok: false; reason: string };

/**
 * Integer cents from a percentage, rounded once, never chained.
 *
 * ── `dealerFeePct` IS 0–100, NOT 0–1 ────────────────────────────────────────
 * A 25% fee is stored as `25`. `solar-money.ts` is the authority and divides by
 * 100 (`rawPct / 100`), so this must too. Treating it as a fraction turns a
 * $40,000 contract's fee into $1,000,000 and its funding expectation into minus
 * $960,000 — a number so wrong it would be caught, which is the only reason
 * that error is survivable. A fee of `0.25` meaning 25%, by contrast, would
 * quietly under-fund by a rounding-sized amount forever.
 *
 * The milestone shares (`fundingM1Pct`) are a DIFFERENT convention: they are
 * fractions, 0–1, because this branch defined them and nothing else reads them.
 * They are applied by `applyFraction` below, and the two are deliberately named
 * apart so a call site cannot pick the wrong one by accident.
 */
const applyPercent = (cents: number, pct: number): number => {
  // The same guard the pricing code uses: a fee at or above 100% has no honest
  // gross-up, and standing it down beats emitting a negative expectation.
  const f = Number.isFinite(pct) && pct > 0 && pct < 100 ? pct / 100 : 0;
  return Math.round(cents * f);
};

/** Milestone shares are fractions (0.6 = 60%), set by this branch alone. */
const applyFraction = (cents: number, fraction: number): number => {
  const f = Number.isFinite(fraction) && fraction > 0 && fraction <= 1 ? fraction : 0;
  return Math.round(cents * f);
};

/**
 * What this deal's lender should send, and when.
 *
 * Returns `ok: false` with a readable reason rather than throwing: "this deal
 * is cash" and "this lender has no funding pattern" are ordinary states a
 * screen needs to explain, not errors.
 */
export async function fundingPlanFor(companyId: string, leadId: string): Promise<FundingPlan> {
  const finance = await runUnscoped(
    "lender funding: read a deal's financing to form the funding expectation",
    () => prisma.solarFinance.findFirst({
    where: { companyId, leadId },
    select: {
      product: true,
      contractPriceCents: true,
      dealerFeePct: true,
      lenderProduct: {
        select: {
          dealerFeePct: true,
          lender: {
            select: {
              id: true,
              fundsNetOfDealerFee: true,
              fundingM1Pct: true,
              fundingM2Pct: true,
            },
          },
        },
      },
    },
    })
  );

  if (!finance) return { ok: false, reason: "This deal has no financing recorded." };
  if (finance.product === "cash") {
    return { ok: false, reason: "A cash deal is paid by the customer, not funded by a lender." };
  }
  const lender = finance.lenderProduct?.lender;
  if (!lender) return { ok: false, reason: "No lender product is chosen on this deal." };
  if (finance.contractPriceCents <= 0) {
    return { ok: false, reason: "This deal has no contract price yet." };
  }

  // The deal's own fee wins; the product's rate is the fallback for a deal
  // written before the fee was stamped on it. Zero from BOTH is taken at face
  // value — some partners genuinely charge nothing — which is why the fallback
  // is on null rather than on falsy.
  const dealerFeePct = finance.dealerFeePct || (finance.lenderProduct?.dealerFeePct ?? 0);

  const netCents = lender.fundsNetOfDealerFee
    ? finance.contractPriceCents - applyPercent(finance.contractPriceCents, dealerFeePct)
    : finance.contractPriceCents;

  const milestones: ExpectedFunding[] = [];
  if (lender.fundingM1Pct != null) {
    milestones.push({ milestone: "m1", expectedCents: applyFraction(netCents, lender.fundingM1Pct) });
  }
  if (lender.fundingM2Pct != null) {
    milestones.push({ milestone: "m2", expectedCents: applyFraction(netCents, lender.fundingM2Pct) });
  }

  if (milestones.length === 0) {
    return {
      ok: false,
      reason: "This lender has no funding schedule configured, so deposits are recorded by hand.",
    };
  }

  /**
   * ROUNDING GOES TO THE LAST STAGE.
   *
   * 60% + 40% of an odd number of cents does not come back to the number. Left
   * alone, a deal would sit permanently one cent short with no way to close it,
   * and somebody would eventually "fix" it by editing a figure. The last
   * milestone absorbs the remainder, which is the standard treatment.
   */
  const allocated = milestones.reduce((s, m) => s + m.expectedCents, 0);
  const drift = netCents - allocated;
  if (drift !== 0 && milestones.length > 0) {
    milestones[milestones.length - 1].expectedCents += drift;
  }

  return { ok: true, lenderId: lender.id, netCents, dealerFeePct, milestones };
}

/**
 * Write (or refresh) the expectations for a deal.
 *
 * Upserts on `(companyId, leadId, milestone)`, so re-running after a price
 * change updates the expectation instead of opening a second one. A milestone
 * that has already been RECEIVED is left alone: the money arrived, and quietly
 * re-baselining a settled row would erase the variance that was recorded.
 */
export async function syncExpectedFundings(args: {
  companyId: string;
  leadId: string;
}): Promise<{ ok: true; written: number; skipped: number } | { ok: false; error: string }> {
  const plan = await fundingPlanFor(args.companyId, args.leadId);
  if (!plan.ok) return { ok: false, error: plan.reason };

  let written = 0;
  let skipped = 0;

  for (const m of plan.milestones) {
    const existing = await prisma.lenderFunding.findFirst({
      where: { companyId: args.companyId, leadId: args.leadId, milestone: m.milestone },
      select: { id: true, status: true },
    });

    if (existing && existing.status !== "expected") {
      skipped++;
      continue;
    }

    if (existing) {
      await prisma.lenderFunding.update({
        where: { id: existing.id },
        data: { expectedCents: m.expectedCents, lenderId: plan.lenderId },
      });
    } else {
      await prisma.lenderFunding.create({
        data: {
          companyId: args.companyId,
          leadId: args.leadId,
          lenderId: plan.lenderId,
          milestone: m.milestone,
          expectedCents: m.expectedCents,
          status: "expected",
        },
      });
    }
    written++;
  }

  return { ok: true, written, skipped };
}

/** Open expectations, newest deal first — the "who owes us" list. */
export async function openFundings(companyId: string) {
  return runUnscoped("lender funding: list what lenders still owe, across departments", () =>
    prisma.lenderFunding.findMany({
    where: { companyId, status: "expected" },
    orderBy: [{ createdAt: "desc" }],
    select: {
      id: true,
      leadId: true,
      milestone: true,
      expectedCents: true,
      expectedAt: true,
      lender: { select: { id: true, name: true } },
      lead: { select: { firstName: true, lastName: true } },
      },
    })
  );
}

/** Status a settled funding lands in, from the difference alone. */
function settledStatus(expectedCents: number, receivedCents: number): FundingStatus {
  if (receivedCents === expectedCents) return "received";
  return receivedCents < expectedCents ? "short" : "over";
}

export type RecogniseResult =
  | { ok: true; entryId: string; varianceCents: number; status: FundingStatus }
  | { ok: false; error: string };

/**
 * Record that a lender's deposit arrived, and book it.
 *
 *   DEBIT  the bank              what actually landed
 *   CREDIT accounts receivable   what the deal was owed
 *   the difference               Dealer Fees or Funding Variance (see header)
 *
 * The entry balances by construction: received + shortfall = expected.
 *
 * `actor` may be a SYSTEM actor — auto-funding a single unambiguous match runs
 * as `{ kind: "system" }`, and `postJournalEntry` records that in the audit
 * trail exactly as it records a person.
 */
export async function recogniseFunding(args: {
  companyId: string;
  fundingId: string;
  bankLedgerAccountId: string;
  receivedCents: number;
  date: Date;
  actor: PostingActor;
  feedTransactionId?: string | null;
  memo?: string | null;
}): Promise<RecogniseResult> {
  if (!Number.isInteger(args.receivedCents) || args.receivedCents <= 0) {
    return { ok: false, error: "A deposit must be a positive whole number of cents." };
  }

  const funding = await runUnscoped(
    "lender funding: read the expectation, its lender and its job to book a deposit",
    () => prisma.lenderFunding.findFirst({
    where: { id: args.fundingId, companyId: args.companyId },
    select: {
      id: true,
      leadId: true,
      milestone: true,
      expectedCents: true,
      status: true,
      lead: { select: { project: { select: { id: true } } } },
      lender: { select: { name: true, fundsNetOfDealerFee: true } },
      },
    })
  );
  if (!funding) return { ok: false, error: "That funding is not on this company." };
  if (funding.status !== "expected") {
    return { ok: false, error: `This milestone has already been recorded as ${funding.status}.` };
  }

  const varianceCents = args.receivedCents - funding.expectedCents;
  const status = settledStatus(funding.expectedCents, args.receivedCents);

  // Derived from the lender's configuration, never from the size of the gap.
  // See the header: a gross expectation means the shortfall IS the dealer fee.
  const varianceKey = funding.lender?.fundsNetOfDealerFee === false ? "dealer_fees" : "funding_variance";

  // The job, when the deal became one. A funding on a deal with no job yet is
  // ordinary — lenders release M1 around install — and the line simply carries
  // no project tag, which the vertical extension then resolves from ambient.
  const projectId = funding.lead?.project?.id ?? null;

  // Declared, not cast. `as Parameters<typeof postJournalEntry>[0]["lines"]`
  // would have satisfied the compiler while asking it to check nothing — and a
  // journal line with a misspelled key is precisely the error that survives a
  // cast, passes tsc, and posts a silently unbalanced entry.
  const lines: JournalLineInput[] = [
    { accountId: args.bankLedgerAccountId, debitCents: args.receivedCents, projectId },
    { systemKey: "accounts_receivable", creditCents: funding.expectedCents, projectId },
  ];

  if (varianceCents !== 0) {
    lines.push(
      varianceCents < 0
        ? { systemKey: varianceKey, debitCents: -varianceCents, projectId }
        : { systemKey: varianceKey, creditCents: varianceCents, projectId }
    );
  }

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: args.date,
    memo: args.memo ?? `${funding.lender?.name ?? "Lender"} funding ${funding.milestone.toUpperCase()}`,
    sourceType: "funding",
    // Keyed by the funding row, so a retry cannot book the same deposit twice.
    sourceId: `funding:${funding.id}`,
    actor: args.actor,
    lines,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.lenderFunding.update({
    where: { id: funding.id },
    data: {
      receivedCents: args.receivedCents,
      status,
      receivedAt: args.date,
      journalEntryId: res.entryId,
      bankFeedTransactionId: args.feedTransactionId ?? null,
      decidedById: args.actor.kind === "user" ? args.actor.userId : null,
      decidedAt: new Date(),
    },
  });

  return { ok: true, entryId: res.entryId, varianceCents, status };
}

/**
 * Expectations a deposit of this size could be, within the lender's tolerance.
 *
 * Tolerance is per lender and defaults to zero, which means exact cents. That
 * default is intentional: a lender whose rounding nobody has measured should
 * not be auto-matched on a guess. Configure it once the pattern is known.
 *
 * Returning EVERY candidate rather than the best one is the point — the caller
 * auto-posts only when there is exactly one, and a list of two is the signal
 * that a person has to choose.
 */
export async function fundingCandidatesFor(args: {
  companyId: string;
  amountCents: number;
}): Promise<{ id: string; leadId: string; milestone: FundingMilestone; expectedCents: number; lenderName: string | null }[]> {
  if (args.amountCents <= 0) return [];

  const open = await runUnscoped(
    "lender funding: find which expectations a deposit of this size could settle",
    () => prisma.lenderFunding.findMany({
    where: { companyId: args.companyId, status: "expected" },
    select: {
      id: true,
      leadId: true,
      milestone: true,
      expectedCents: true,
      lender: { select: { name: true, fundingToleranceCents: true } },
      },
    })
  );

  return open
    .filter((f) => {
      const tolerance = f.lender?.fundingToleranceCents ?? 0;
      return Math.abs(args.amountCents - f.expectedCents) <= tolerance;
    })
    .map((f) => ({
      id: f.id,
      leadId: f.leadId,
      milestone: f.milestone,
      expectedCents: f.expectedCents,
      lenderName: f.lender?.name ?? null,
    }));
}
