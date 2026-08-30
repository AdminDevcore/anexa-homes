/**
 * WHAT THE HOUSEHOLD ACTUALLY PAYS, on a deal whose contract is written for
 * more than the system was priced at.
 *
 * This module exists because of one structure and should not be read as a
 * general-purpose incentive engine. A prepaid-lease partner writes its paper at
 *
 *     quoted price          $55,000    10 kW at $5.50/W
 *   + programme adjustment  $70,000
 *   = contract value       $125,000
 *
 * and the federal credits are earned on the CONTRACT, not on the quoted price.
 * Fifty percent of $125,000 is $62,500 — more than the system was sold for —
 * so after the credits are claimed there is money left over between what the
 * household still owes and what they were quoted. That remainder is not a
 * rounding artefact and it is not profit hiding: it is the difference between
 * the two figures, and this module hands it back as a signing incentive so the
 * household lands exactly on the price they were quoted.
 *
 *     contract value        $125,000
 *   − federal credit 30%     $37,500
 *   − energy community 10%   $12,500
 *   − domestic content 10%   $12,500
 *   = after credits          $62,500
 *   − signing incentive       $7,500   ← DERIVED, never typed
 *   = what you pay           $55,000   ← the quoted price, again
 *
 * THREE RULES.
 *
 *  1. THE INCENTIVE IS ALWAYS THE DIFFERENCE. Nobody types it, no setting holds
 *     it, and it cannot be edited on a deal. It is `afterCredits − quoted`,
 *     which is the only definition under which the bottom line of this ladder
 *     is guaranteed to equal the price the customer was actually quoted. A
 *     typed incentive is a fourth number that can disagree with the other
 *     three.
 *
 *  2. IT NEVER GOES NEGATIVE. On a system large enough that the credits alone
 *     take the contract below the quoted price — 20 kW at $5.50 with the same
 *     $70,000 adjustment lands at $90,000 after credits against a $110,000
 *     quote — there is nothing to give away, and the honest bottom line is the
 *     after-credit figure. The incentive row is DROPPED rather than printed at
 *     zero or, worse, at a negative that reads as a fee. `shortfallCents`
 *     records how far the other way it went, for the rep's screen; nothing
 *     customer-facing reads it.
 *
 *  3. A CREDIT IS A CLAIM ABOUT SOMEBODY'S TAX RETURN. The energy-community
 *     and domestic-content bonuses are conditional on the address and on the
 *     equipment, and neither is ours to assume: each is a per-deal answer, and
 *     a deal that does not qualify simply does not carry that line. The
 *     percentages themselves are the company's to state, because they are
 *     statute and statute moves.
 *
 * PURE. Money in cents, no I/O, no React — so the builder, the readiness gate,
 * the frozen snapshot and the customer's document all reach the same figures
 * through the same arithmetic.
 */

/** The three credits, in the order they are always shown. */
export type CreditKey = "itc" | "energyCommunity" | "domesticContent";

/**
 * What each credit is CALLED on a document a homeowner keeps.
 *
 * Hard-coded, unlike the programme-adjustment label next door, and the
 * difference is deliberate: these are the statutory names of federal tax
 * provisions rather than a characterisation of anyone's money. "Federal solar
 * tax credit" is what the credit is called by the people who administer it.
 */
export const CREDIT_LABEL: Record<CreditKey, string> = {
  itc: "Federal solar tax credit",
  energyCommunity: "Energy community bonus",
  domesticContent: "Domestic content bonus",
};

/** Why a deal might not earn one, for the tick-box's own help text. */
export const CREDIT_HINT: Record<CreditKey, string> = {
  itc: "The base residential credit. Claimed on nearly every owned system.",
  energyCommunity: "Depends on the address falling inside a qualifying census tract.",
  domesticContent: "Depends on the modules and inverters meeting the sourcing threshold.",
};

/** The company's percentages. Statute, so an admin states them. */
export type CreditRates = {
  itcPct: number;
  energyCommunityPct: number;
  domesticContentPct: number;
};

/** Which of them THIS address and THIS equipment actually earn. */
export type CreditClaims = {
  itc: boolean;
  energyCommunity: boolean;
  domesticContent: boolean;
};

/** One row of the ladder. */
export type CreditLine = {
  key: CreditKey;
  label: string;
  pct: number;
  amountCents: number;
};

/**
 * The ladder, reconciled — the shape the builder, the snapshot and the
 * customer's page all read.
 *
 * `contractValueCents − creditTotalCents − incentiveCents === netCostCents` is
 * an invariant, not a hope: `ladderReconciles` asserts it at generation and the
 * proposal is refused if it ever fails to hold.
 */
export type CreditLadder = {
  /** What the partner's paper is written at. The top row. */
  contractValueCents: number;
  /** The price the system was actually sold at — the ladder's target. */
  quotedPriceCents: number;
  /** Only the credits this deal claims. Empty is a legitimate answer. */
  credits: CreditLine[];
  creditTotalCents: number;
  /** contract − credits. What is still owed before anything is handed back. */
  afterCreditsCents: number;
  /** The customer-facing term for the remainder. Never empty. */
  incentiveLabel: string;
  /** afterCredits − quoted, floored at zero. Zero means no row is shown. */
  incentiveCents: number;
  /**
   * How far the credits took the contract BELOW the quoted price, cents.
   *
   * Zero on the ordinary case. Positive means the household nets better than
   * the price they were quoted, which is not a fault — but it is worth a rep
   * knowing, because it usually means the adjustment is too small for a system
   * this size. Never printed on the customer's document.
   */
  shortfallCents: number;
  /** The bottom line: after credits, less the incentive. */
  netCostCents: number;
  /** creditTotal + incentive — everything that comes off the contract. */
  reliefCents: number;
  /** The tax caveat, as the company words it. Never empty. */
  disclaimer: string;
};

/**
 * The caveat that has to sit under a page of tax-credit arithmetic.
 *
 * Defaulted rather than demanded, which is the opposite of how the programme
 * adjustment's wording is handled next door, and for a reason: that label is a
 * legal characterisation of a lender's money and only an admin can make it,
 * whereas this is a statement that we are not the reader's accountant. An
 * unworded version of THAT is not a blank space on the page — it is a page of
 * credit figures with nothing qualifying them, which is the outcome the block
 * exists to prevent. An admin may still replace every word of it.
 */
export const CREDIT_DISCLAIMER_DEFAULT =
  "Tax credits are claimed on your own federal return and depend on your tax " +
  "liability and on your eligibility for each credit shown. They are not a " +
  "discount applied by us and they are not a guarantee. We are not tax " +
  "advisers — please confirm with your tax professional.";

/** What the remainder is called when a company has not said. */
export const CREDIT_INCENTIVE_LABEL_DEFAULT = "Incentive for signing today";

/** Every deal earns the base credit until somebody says otherwise. */
export const CREDIT_CLAIMS_DEFAULT: CreditClaims = {
  itc: true,
  energyCommunity: true,
  domesticContent: true,
};

/** The percentages as they stand in statute today. */
export const CREDIT_RATES_DEFAULT: CreditRates = {
  itcPct: 30,
  energyCommunityPct: 10,
  domesticContentPct: 10,
};

/** A percentage that can actually be quoted: present, finite and above zero. */
function usablePct(pct: number | null | undefined): number | null {
  if (pct == null || !Number.isFinite(pct) || pct <= 0) return null;
  return pct;
}

/**
 * The ladder for one deal, or null when there is none to draw.
 *
 * NULL — meaning "this document says nothing about credits" — when the contract
 * value is not above zero, or when no credit is claimed AND there is no
 * remainder to hand back. The second half matters: a deal with every credit
 * switched off but a programme adjustment still has something true to say
 * (contract, less the incentive, is your price), and dropping the page there
 * would leave a $125,000 contract on the document with nothing explaining how
 * a household gets to $55,000.
 *
 * `quotedPriceCents` goes in unchanged and comes back out as `netCostCents`
 * whenever there is any remainder at all — that equality IS the feature.
 */
export function buildCreditLadder(input: {
  contractValueCents: number;
  quotedPriceCents: number;
  rates: CreditRates;
  claims?: CreditClaims | null;
  incentiveLabel?: string | null;
  disclaimer?: string | null;
}): CreditLadder | null {
  const contractValueCents = Math.round(input.contractValueCents);
  const quotedPriceCents = Math.max(0, Math.round(input.quotedPriceCents));
  if (!(contractValueCents > 0)) return null;

  const claims = input.claims ?? CREDIT_CLAIMS_DEFAULT;
  const wanted: Array<[CreditKey, number | null]> = [
    ["itc", claims.itc ? usablePct(input.rates.itcPct) : null],
    [
      "energyCommunity",
      claims.energyCommunity ? usablePct(input.rates.energyCommunityPct) : null,
    ],
    [
      "domesticContent",
      claims.domesticContent ? usablePct(input.rates.domesticContentPct) : null,
    ],
  ];

  const credits: CreditLine[] = [];
  for (const [key, pct] of wanted) {
    if (pct == null) continue;
    credits.push({
      key,
      label: CREDIT_LABEL[key],
      pct,
      amountCents: Math.round((contractValueCents * pct) / 100),
    });
  }

  // Clamped at the contract, because a ladder cannot credit away more than the
  // paper is written for. Only reachable by an admin typing percentages that
  // sum past 100, and the alternative there is a negative bottom line on a
  // document a household signs.
  const creditTotalCents = Math.min(
    contractValueCents,
    credits.reduce((n, c) => n + c.amountCents, 0)
  );
  const afterCreditsCents = contractValueCents - creditTotalCents;

  // RULE 1 AND RULE 2, in one line. Positive is the money handed back; the
  // other direction is recorded and never shown.
  const remainder = afterCreditsCents - quotedPriceCents;
  const incentiveCents = Math.max(0, remainder);
  const shortfallCents = Math.max(0, -remainder);
  const netCostCents = afterCreditsCents - incentiveCents;

  if (credits.length === 0 && incentiveCents === 0) return null;

  return {
    contractValueCents,
    quotedPriceCents,
    credits,
    creditTotalCents,
    afterCreditsCents,
    incentiveLabel: input.incentiveLabel?.trim() || CREDIT_INCENTIVE_LABEL_DEFAULT,
    incentiveCents,
    shortfallCents,
    netCostCents,
    reliefCents: creditTotalCents + incentiveCents,
    disclaimer: input.disclaimer?.trim() || CREDIT_DISCLAIMER_DEFAULT,
  };
}

/**
 * THE INVARIANT, checked rather than assumed.
 *
 * Cheap, and it guards the failure that matters: a future edit that starts
 * deriving one of these figures from another would still produce five
 * plausible numbers, printed on a page a household reads as arithmetic, that do
 * not subtract. Generation refuses rather than emit one.
 */
export function ladderReconciles(l: CreditLadder): boolean {
  const linesSum = l.credits.reduce((n, c) => n + c.amountCents, 0);
  return (
    l.contractValueCents > 0 &&
    l.creditTotalCents >= 0 &&
    l.incentiveCents >= 0 &&
    l.netCostCents >= 0 &&
    // The printed rows must add up to the printed total, or a reader with a
    // calculator finds the gap before we do.
    Math.min(l.contractValueCents, linesSum) === l.creditTotalCents &&
    l.afterCreditsCents === l.contractValueCents - l.creditTotalCents &&
    l.netCostCents === l.afterCreditsCents - l.incentiveCents &&
    l.reliefCents === l.creditTotalCents + l.incentiveCents &&
    // Whenever anything was handed back, the bottom line IS the quoted price.
    (l.incentiveCents === 0 || l.netCostCents === l.quotedPriceCents)
  );
}
