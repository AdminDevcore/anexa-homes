import type { LenderProductTerms } from "@/lib/solar-finance-row";
import type { FinalPpwMode, PriceBasis } from "@/lib/solar-money";

/**
 * The terms a deal is priced from, read off a rate-sheet row.
 *
 * Exists because those terms are not all on the row. Most of them are — the
 * APR, the term, the dealer fee — but the ceiling on what a homeowner may be
 * quoted per watt belongs to the PARTNER, not to any one of its programmes:
 * Amos funds at $5.50/W whether the paper is thirty years or twenty, so
 * entering it once against the lender is the only way it stays one number.
 *
 * That split means every query resolving a programme has to reach one relation
 * further and then flatten it. Two call sites do — the finance save and the
 * re-price — and a third would have joined them; a select they each spell out
 * for themselves is a select that drifts, and a drifted one here loses a cap
 * silently, which reads as the feature simply not working on that screen.
 */

/**
 * Pass to `prisma.solarLenderProduct.findFirst({ select: LENDER_TERMS_SELECT })`.
 * Everything `financeRowForProduct` reads, and nothing it does not.
 */
export const LENDER_TERMS_SELECT = {
  id: true,
  product: true,
  aprPct: true,
  termMonths: true,
  dealerFeePct: true,
  leaseRateCentsPerKwMonth: true,
  rateMillsPerKwh: true,
  escalatorPct: true,
  termYears: true,
  // Which price the partner's figure fixes IS the programme's to say — one
  // partner's $5.50 is the gross on one product and the base on another.
  ppwBasis: true,
  batteryPriceBasis: true,
  lender: { select: { priceRulePpwCents: true, priceRuleMode: true } },
} as const;

/** What that select comes back as. */
export type LenderTermsRow = Omit<
  LenderProductTerms,
  "maxFinalPpwCents" | "finalPpwMode" | "ppwBasis" | "batteryPriceBasis"
> & {
  ppwBasis: PriceBasis;
  batteryPriceBasis: PriceBasis;
  lender: { priceRulePpwCents: number | null; priceRuleMode: FinalPpwMode };
};

/** Flatten the partner's price rule onto the programme's own terms. */
export function toLenderProductTerms(row: LenderTermsRow): LenderProductTerms;
export function toLenderProductTerms(row: LenderTermsRow | null): LenderProductTerms | null;
export function toLenderProductTerms(row: LenderTermsRow | null): LenderProductTerms | null {
  if (!row) return null;
  const { lender, ...terms } = row;
  return {
    ...terms,
    maxFinalPpwCents: lender.priceRulePpwCents,
    finalPpwMode: lender.priceRuleMode,
  };
}
