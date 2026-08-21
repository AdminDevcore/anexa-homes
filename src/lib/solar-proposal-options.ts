import type { FinanceProduct } from "@prisma/client";
import { financeRowForProduct } from "./solar-finance-row";
import { lenderProductLabel } from "./solar-lender-product";
import type { ProposalAlternative, ProposalFinanceInput } from "./solar-proposal";
import type { SolarAssumptions } from "./solar-money";

/**
 * Turning a company's rate sheet into the menu a homeowner can actually choose
 * from.
 *
 * WHY THIS IS A PURE FUNCTION AND NOT A QUERY: the rules about what belongs on
 * that menu are business rules a customer reads the consequences of — which
 * lenders may be offered, what cash is priced at, how many options a household
 * can be asked to compare — and every one of them is a rule somebody will want
 * to argue about. Rules that can be argued about need to be testable without a
 * database.
 *
 * THE PRICES ARE COMPUTED HERE, ONCE, AT GENERATION. They are then frozen into
 * the snapshot with everything else. The customer's copy never derives a price:
 * it reads one. That is the difference between a document and a calculator, and
 * only one of the two is a record of what was offered.
 */

/** One row of the rate sheet, with the lender it belongs to. */
export type CatalogueProgramme = {
  id: string;
  product: FinanceProduct;
  name: string | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  leaseRateCentsPerKwMonth: number | null;
  rateMillsPerKwh: number | null;
  escalatorPct: number | null;
  termYears: number | null;
  factorWithPaydownMicros: number | null;
  factorWithoutPaydownMicros: number | null;
  paydownPct: number | null;
  paydownMonths: number | null;
  rank: number;
  lender: {
    id: string;
    name: string;
    rank: number;
    applyUrl: string | null;
    /** Our own serving URL for the partner's mark, never the bank's CDN. */
    logoUrl: string | null;
    /**
     * The partner's ceiling on the final price per watt, cents. On the LENDER
     * because it is the partner's rule and not one programme's — a menu that
     * offered a household a capped programme at the uncapped price would be
     * frozen into the snapshot and outlive anybody's chance to correct it.
     */
    maxFinalPpwCents: number | null;
  };
};

/**
 * How many ways of paying a household is asked to compare, in total.
 *
 * Six, including the quoted one. Not "all of them": a company with a full rate
 * sheet has forty rows, and forty prices in a menu is not a choice, it is a
 * spreadsheet handed to somebody who did not ask for one. The rep still leads
 * with one option — the quoted one is first and preselected — and the rest are
 * there for the household that wants to see them.
 */
export const MAX_PAYMENT_OPTIONS = 6;

export type AlternativesInput = {
  /** The deal's own terms, so the menu neither repeats nor contradicts them. */
  quoted: {
    product: FinanceProduct;
    /** The catalogue row this deal was quoted from, when it was quoted from one. */
    lenderProductId: string | null;
    /** The deal's sticker per watt, cents. Carries the lender's fee on a loan. */
    grossPpwCents: number;
    dealerFeePct: number;
  };
  /** Every active rate-sheet row, already scoped to this company. */
  programmes: CatalogueProgramme[];
  /**
   * The lenders whose approved-vendor list covers the equipment on this design,
   * or NULL when nothing is constrained — a company that has not populated any
   * AVL constrains nothing, exactly as the equipment selectors already behave.
   *
   * A programme from a lender that will not finance this panel is not an option,
   * it is a phone call three weeks later.
   */
  approvedLenderIds: string[] | null;
  design: { systemSizeKwDc: number };
  /** The extra work, at CATALOGUE price. Grossed up per option by its own fee. */
  adders: { label: string; amountCents: number }[];
  adderTotalCents: number;
  assumptions: SolarAssumptions;
  /** What the company must keep per watt after the lender's cut, cents. */
  targetNetPpwCents: number | null;
  max?: number;
};

export function proposalAlternatives(input: AlternativesInput): ProposalAlternative[] {
  const max = input.max ?? MAX_PAYMENT_OPTIONS;
  // One slot is already taken by the option the deal was quoted on.
  const room = Math.max(0, max - 1);
  if (room === 0) return [];

  const out: ProposalAlternative[] = [];

  // ── Cash, first among the alternatives ────────────────────────────────────
  // The one option every household understands, and the one a financed quote
  // never shows. Priced at what the company actually needs to keep — NOT at the
  // loan's sticker, which carries a lender's fee for money nobody is borrowing.
  // Quoting cash at the financed price is how a customer who offered to write a
  // cheque ends up paying the bank's cut anyway.
  if (input.quoted.product !== "cash") {
    out.push({
      key: "cash",
      label: "Pay in full",
      lender: null,
      finance: purchaseFinance({
        product: "cash",
        grossPpwCents: cashPpwCents(input),
        dealerFeePct: 0,
        adders: input.adders,
        adderTotalCents: input.adderTotalCents,
      }),
    });
  }

  // ── The rate sheet ────────────────────────────────────────────────────────
  const eligible = input.programmes
    .filter((p) => p.id !== input.quoted.lenderProductId)
    .filter((p) => lenderIsApproved(p.lender.id, input.approvedLenderIds))
    .sort(
      (a, b) =>
        a.lender.rank - b.lender.rank ||
        a.lender.name.localeCompare(b.lender.name) ||
        a.rank - b.rank
    );

  // At most ONE programme per lender. A homeowner comparing four of GoodLeap's
  // terms against nothing else is comparing paperwork, not offers; the point of
  // the menu is breadth across partners. The rate sheet's own ranking decides
  // which of a lender's rows leads, which is what `rank` is for.
  const usedLenders = new Set<string>();

  for (const p of eligible) {
    if (out.length >= room) break;
    if (usedLenders.has(p.lender.id)) continue;
    usedLenders.add(p.lender.id);

    const row = financeRowForProduct(
      { product: p.product, adderTotalCents: input.adderTotalCents },
      {
        systemSizeKwDc: input.design.systemSizeKwDc,
        assumptions: input.assumptions,
        lenderProduct: {
          id: p.id,
          product: p.product,
          aprPct: p.aprPct,
          termMonths: p.termMonths,
          dealerFeePct: p.dealerFeePct,
          leaseRateCentsPerKwMonth: p.leaseRateCentsPerKwMonth,
          rateMillsPerKwh: p.rateMillsPerKwh,
          escalatorPct: p.escalatorPct,
          termYears: p.termYears,
          maxFinalPpwCents: p.lender.maxFinalPpwCents,
        },
        targetNetPpwCents: input.targetNetPpwCents,
      }
    );

    out.push({
      key: `${p.product}:${p.id}`,
      label: `${p.lender.name} · ${lenderProductLabel(p)}`,
      lender: p.lender.name,
      lenderLogoUrl: p.lender.logoUrl,
      lenderApplyUrl: p.lender.applyUrl,
      loanFactors:
        p.product === "loan"
          ? {
              factorWithPaydownMicros: p.factorWithPaydownMicros,
              factorWithoutPaydownMicros: p.factorWithoutPaydownMicros,
              paydownPct: p.paydownPct,
              paydownMonths: p.paydownMonths,
            }
          : null,
      finance: {
        product: row.product,
        grossPpwCents: row.grossPpwCents,
        dealerFeePct: row.dealerFeePct,
        adderTotalCents: row.adderTotalCents,
        ...(row.adderTotalCents > 0 ? { adders: input.adders } : {}),
        rateMillsPerKwh: row.rateMillsPerKwh,
        monthlyPaymentCents: row.monthlyPaymentCents,
        escalatorPct: row.escalatorPct,
        termYears: row.termYears,
        aprPct: row.aprPct,
        loanTermMonths: row.loanTermMonths,
        // Deliberately NOT carried across: the approved payment and the money
        // the customer put down belong to the deal that was actually
        // underwritten. Quoting another lender's programme with this lender's
        // approved figure is a payment nobody has agreed to.
        loanMonthlyPaymentCents: null,
        downPaymentCents: null,
      },
    });
  }

  return out;
}

/**
 * What cash is priced at.
 *
 * The company's own target net rate when one is set — that is exactly what the
 * figure means: what has to be kept per watt once the lender is out of the
 * picture, and on cash the lender is out of the picture. Otherwise the deal's
 * sticker with its dealer fee taken back out, which is the same number arrived
 * at from the other end.
 */
export function cashPpwCents(input: {
  quoted: { product: FinanceProduct; grossPpwCents: number; dealerFeePct: number };
  targetNetPpwCents: number | null;
}): number {
  if (input.targetNetPpwCents != null && input.targetNetPpwCents > 0) {
    return input.targetNetPpwCents;
  }
  const f = input.quoted.dealerFeePct;
  const fee = Number.isFinite(f) && f > 0 && f < 100 ? f / 100 : 0;
  return Math.round(input.quoted.grossPpwCents * (1 - fee));
}

function lenderIsApproved(lenderId: string, approved: string[] | null): boolean {
  return approved === null || approved.includes(lenderId);
}

function purchaseFinance(a: {
  product: "cash";
  grossPpwCents: number;
  dealerFeePct: number;
  adders: { label: string; amountCents: number }[];
  adderTotalCents: number;
}): ProposalFinanceInput {
  return {
    product: a.product,
    grossPpwCents: a.grossPpwCents,
    dealerFeePct: a.dealerFeePct,
    adderTotalCents: a.adderTotalCents,
    ...(a.adderTotalCents > 0 ? { adders: a.adders } : {}),
    rateMillsPerKwh: null,
    monthlyPaymentCents: null,
    escalatorPct: null,
    termYears: null,
    aprPct: null,
  };
}
