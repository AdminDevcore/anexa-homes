import type { FinanceProduct } from "@prisma/client";

/**
 * ONE FEE RULE, AND WHERE THE NUMBER CAME FROM.
 *
 * The dealer fee reaches a deal from three places, and before this they were
 * resolved in three different orders by three different files. `financeRowForProduct`
 * read the programme first; generation read the deal's stored copy and ignored the
 * programme row it had already fetched; readiness read the stored copy too. So one
 * deal could be PRICED on the programme's fee and JUDGED against its own, and the
 * lender floor was measured on a number nothing else used.
 *
 * PRECEDENCE, earliest wins:
 *   1. the PROGRAMME's fee today — the partner's published rate
 *   2. the copy cached on the deal — what it was last generated at
 *   3. the company default — a starting point, for a deal quoting no programme
 *
 * (1) is what makes an unsigned quote current: a partner who changes their rate
 * sheet has changed the price of every quote not yet signed, and a stored copy
 * that silently outranked them is how a rep quotes a rate the lender withdrew.
 *
 * WHAT THIS DELIBERATELY DOES NOT DO: freeze. A signed deal is not protected
 * here, because it is already protected somewhere better — a signed document
 * reads its own v9 snapshot, which was written at generation and never
 * recomputed. Adding a second freeze in this function would put two mechanisms
 * in charge of one fact, and the moment they disagreed the snapshot would still
 * be right and this would still be wrong.
 *
 * `??` and never `||`: a legitimate ZERO is the whole problem this file exists
 * around. Amos 30 Year Solar publishes 0% on production today, and `||` would
 * read that real, deliberate zero as "unset" and fall through to a stale 65%
 * cached on the deal — quoting a fee the programme does not charge.
 */
export type DealerFeeSource =
  /** The programme's published rate, read fresh. */
  | "programme"
  /** The copy cached on the deal at its last generation. */
  | "deal"
  /** The company's fallback, for a deal quoting no programme. */
  | "companyDefault"
  /** No lender on this deal at all, so no fee exists to source. */
  | "none";

export type ResolvedDealerFee = {
  /** The fee as a percentage, 0–100. Always a number; never null. */
  pct: number;
  /** Which of the three it came from, so a screen can print why. */
  source: DealerFeeSource;
};

export type DealerFeeInput = {
  product: FinanceProduct;
  /** The programme's fee TODAY. Null when the deal quotes no programme. */
  programmePct?: number | null;
  /** The copy cached on `SolarFinance.dealerFeePct`. */
  dealPct?: number | null;
  /** `SolarSettings.defaultDealerFeePct`. */
  companyDefaultPct?: number | null;
};

/**
 * The fee this deal is priced at, and where it came from.
 *
 * Cash has no lender and therefore no fee — not a zero fee, NO fee, which is
 * why the source says `none` rather than naming a place the zero came from.
 * Lease and PPA sell electricity rather than a system: the household buys
 * nothing for a lender to take a cut of.
 */
export function resolveDealerFee(input: DealerFeeInput): ResolvedDealerFee {
  if (input.product !== "loan") return { pct: 0, source: "none" };
  if (input.programmePct != null) return { pct: input.programmePct, source: "programme" };
  if (input.dealPct != null) return { pct: input.dealPct, source: "deal" };
  if (input.companyDefaultPct != null) {
    return { pct: input.companyDefaultPct, source: "companyDefault" };
  }
  // A loan quoting no programme, on a company that has set no default. Zero is
  // the only honest answer, and `none` says it was not chosen by anybody.
  return { pct: 0, source: "none" };
}

/** Rep-facing wording. Never shown to a customer — the fee never is. */
export const DEALER_FEE_SOURCE_LABEL: Record<DealerFeeSource, string> = {
  programme: "this programme's current rate",
  deal: "saved on this deal",
  companyDefault: "company default",
  none: "no lender on this deal",
};
