/**
 * The one place where a partner's CONTRACT VALUE and the customer's OBLIGATION
 * are different numbers.
 *
 * Everywhere else in this application they are the same figure, held once, in
 * `SolarFinance.contractPriceCents`: the homeowner signs for what the lender
 * funds. A prepaid-lease programme like Participate cannot be said that way.
 * Its paper is written at one value, a fixed programme contribution comes off
 * it, and the household's obligation is what is left:
 *
 *     customer obligation   $48,400   8.80 kW at the quoted $5.50/W
 *   + programme adjustment  $70,000   this partner's configured figure
 *   = contract value       $118,400
 *
 * TWO RULES GOVERN EVERYTHING IN THIS FILE, and both are about not misstating
 * what a household owes:
 *
 *  1. THE ADJUSTMENT IS PURELY ADDITIVE. The customer's price is priced by
 *     exactly the ladder it always was — base, adders, dealer fee, the
 *     partner's cap — and is never rewritten. The adjustment produces a SECOND
 *     figure that sits beside it. Payment, financed amount, savings, payback
 *     and price per watt keep reading the obligation, because that is the money
 *     the customer is liable for. Amortising $118,400 over 360 months quotes a
 *     homeowner $328.89 for a system they owe $134.44 a month on.
 *
 *  2. THE APP HAS NO WORDING OF ITS OWN. What the contribution is CALLED is a
 *     legal characterisation of somebody else's money — "contribution",
 *     "discount", "incentive" and "tax credit" are four different claims, and
 *     three of them are false here. So no label and no sentence is defaulted,
 *     hard-coded or inferred: an admin states the approved term and the
 *     approved paragraph, and generation is blocked until they have.
 *
 * PURE. Money in cents, no I/O, no React — so the lender settings screen, the
 * rep's builder, the readiness gate, the frozen snapshot and the customer's
 * document all reach the same three numbers through the same arithmetic.
 */

/**
 * How the figure is worked out. Mirrors the Prisma enum, redeclared rather than
 * imported so this module stays usable from a client component without pulling
 * the generated client into the browser bundle.
 */
export type ContractAdjustmentType = "fixed";

/** What an admin configured on the lender, as data. */
export type LenderContractAdjustment = {
  enabled: boolean;
  type?: ContractAdjustmentType | null;
  /** The fixed figure, cents. Null is a half-configured programme. */
  fixedCents: number | null;
  /** The customer-facing term. Null is a half-configured programme. */
  label: string | null;
  /** The reconciliation paragraph, as a template. See `renderDisclosure`. */
  disclosure: string | null;
  /** When the programme starts applying. Null means "already running". */
  effectiveAt?: Date | string | null;
};

/**
 * The three figures, reconciled — the shape every screen and the document read.
 *
 * `lenderContractValueCents === customerObligationCents + adjustmentCents` is an
 * invariant, not a hope: `contractReconciles` asserts it at generation and the
 * proposal is refused if it ever fails to hold.
 */
export type ContractReconciliation = {
  /** The approved customer-facing term, frozen. Never empty. */
  label: string;
  /** The partner's fixed contribution, cents. Always > 0. */
  adjustmentCents: number;
  /** What the household is liable for. The number every payment comes off. */
  customerObligationCents: number;
  /** What the partner's paper is written at. */
  lenderContractValueCents: number;
  /** The reconciliation paragraph with its figures substituted in. */
  disclosure: string;
};

/**
 * Whether an adjustment is configured completely enough to quote.
 *
 * Returned as a LIST of specific complaints rather than a boolean, because each
 * one names the box an admin has to go and fill in, and "the Participate
 * settings are incomplete" sends somebody hunting through five fields.
 *
 * An adjustment that is switched OFF is not incomplete — it is off, and returns
 * nothing. That is every lender in the database until somebody turns one on.
 */
export function contractAdjustmentProblems(
  a: LenderContractAdjustment | null | undefined
): string[] {
  if (!a?.enabled) return [];
  const out: string[] = [];
  if (a.fixedCents == null || !Number.isFinite(a.fixedCents) || a.fixedCents <= 0) {
    out.push("no adjustment amount is set");
  }
  if (!a.label?.trim()) out.push("no customer-facing label is set");
  if (!a.disclosure?.trim()) out.push("no customer disclosure is written");
  return out;
}

/** Has this programme started? Null and any past date both mean yes. */
export function adjustmentIsEffective(
  a: LenderContractAdjustment | null | undefined,
  at: Date = new Date()
): boolean {
  if (!a?.enabled) return false;
  if (a.effectiveAt == null) return true;
  const from = a.effectiveAt instanceof Date ? a.effectiveAt : new Date(a.effectiveAt);
  if (Number.isNaN(from.getTime())) return true;
  return from.getTime() <= at.getTime();
}

/**
 * The reconciliation for one deal, or null when there is none to make.
 *
 * NULL — meaning "this document says nothing about a contribution" — for every
 * one of: the partner has none configured, it is switched off, its start date
 * has not arrived, or it is misconfigured. The last of those is deliberately
 * silent HERE and loud in validation: a preview that renders no block is
 * recoverable, and a document that quotes a $0 "Participate Program
 * Contribution" at a homeowner is not.
 *
 * `customerObligationCents` is the price the customer was already quoted. It
 * goes in unchanged and comes out unchanged — the whole contract of this
 * function is that it ADDS a number rather than replacing one.
 */
export function reconcileContract(input: {
  customerObligationCents: number;
  adjustment: LenderContractAdjustment | null | undefined;
  /** Named on the disclosure, when the template asks for it. */
  lenderName?: string | null;
  at?: Date;
}): ContractReconciliation | null {
  const a = input.adjustment;
  if (!adjustmentIsEffective(a, input.at ?? new Date())) return null;
  if (contractAdjustmentProblems(a).length > 0) return null;

  const adjustmentCents = Math.round(a!.fixedCents!);
  const customerObligationCents = Math.round(input.customerObligationCents);
  const lenderContractValueCents = customerObligationCents + adjustmentCents;
  const label = a!.label!.trim();

  return {
    label,
    adjustmentCents,
    customerObligationCents,
    lenderContractValueCents,
    disclosure: renderDisclosure(a!.disclosure!, {
      label,
      lender: input.lenderName ?? null,
      contractValueCents: lenderContractValueCents,
      adjustmentCents,
      customerObligationCents,
    }),
  };
}

/**
 * THE INVARIANT, checked rather than assumed.
 *
 * Cheap, and it guards the failure that matters: a future edit that starts
 * deriving the obligation from the contract value instead of the other way
 * round would still produce three plausible numbers, printed on a document a
 * household signs, that do not add up. Generation refuses rather than emit one.
 */
export function contractReconciles(r: ContractReconciliation): boolean {
  return (
    r.adjustmentCents > 0 &&
    r.customerObligationCents >= 0 &&
    r.lenderContractValueCents === r.customerObligationCents + r.adjustmentCents
  );
}

/**
 * The admin's paragraph with this deal's figures put into it.
 *
 * TOKENS, not string concatenation, and not a sentence in the source. The
 * wording is the admin's — the app supplies only the numbers — so the template
 * decides the order, the emphasis and every word around them. An unknown token
 * is left alone rather than blanked: `{whatever}` surviving into a preview is a
 * typo somebody can see and fix, and an empty gap where a figure should be is
 * one nobody notices until it is on paper.
 */
export function renderDisclosure(
  template: string,
  vars: {
    label: string;
    lender: string | null;
    contractValueCents: number;
    adjustmentCents: number;
    customerObligationCents: number;
  }
): string {
  const table: Record<string, string> = {
    label: vars.label,
    lender: vars.lender ?? "",
    contractValue: money(vars.contractValueCents),
    adjustment: money(vars.adjustmentCents),
    customerObligation: money(vars.customerObligationCents),
  };
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    key in table ? table[key] : whole
  );
}

/** The tokens a disclosure template may use, for the settings screen's help. */
export const DISCLOSURE_TOKENS = [
  { token: "{contractValue}", means: "the adjusted contract value" },
  { token: "{adjustment}", means: "the programme adjustment" },
  { token: "{customerObligation}", means: "what the customer owes" },
  { token: "{label}", means: "the customer-facing label above" },
  { token: "{lender}", means: "the lender's name" },
] as const;

/**
 * A starting point an admin edits, offered by the settings screen when the box
 * is empty — never written to the database on their behalf, and never used as a
 * fallback at generation. The difference matters: a default that fills itself in
 * is wording nobody approved, and this one only ever appears in a form where
 * somebody is looking at it.
 */
export const DISCLOSURE_TEMPLATE_SUGGESTION =
  "The adjusted contract value is {contractValue}. A {adjustment} {label} reduces the " +
  "customer's obligation to {customerObligation}. The customer's payment and financing " +
  "calculations shown above are based on the {customerObligation} customer obligation.";

/**
 * Whether a quoted monthly payment was worked out from the money the customer
 * actually owes.
 *
 * The failure this exists to catch is precise and, on this feature, one typo
 * away: a payment amortised from the CONTRACT VALUE rather than the obligation.
 * On the worked example that is $328.89 a month instead of $134.44 — both
 * plausible-looking figures on a solar proposal, and only one of them is what
 * the household agreed to.
 *
 * A RATIO TO THE PRINCIPAL CANNOT SEPARATE THOSE, which is why this reads the
 * terms as well. $328.89 over 360 months is 2.4x the $48,400 principal, and a
 * perfectly ordinary thirty-year loan at 10% is 3.2x — so any bound wide enough
 * to admit the real loan admits the mistake. Measured against the STATED APR
 * and term the two separate cleanly: at the 0% this deal quotes, the most those
 * terms can ask for is $134.44, and $328.89 is two and a half times a figure
 * that has no interest in it to be explained by.
 *
 * A COARSE GUARD, deliberately, and not a re-derivation of the lender's own
 * arithmetic. A published payment factor carries a dealer fee and a promotional
 * structure and legitimately comes out above a straight amortisation of the
 * same principal — which is exactly why the factor outranks it everywhere else
 * — so the ceiling leaves a third of headroom above the amortised figure. What
 * it will not admit is a payment taken from a different principal altogether.
 *
 * THE PAYDOWN IS SUBTRACTED FIRST. On a programme structured around one, the
 * quoted monthly is the WITH-paydown figure and repays the principal less the
 * paydown — so a floor measured against the whole principal would reject every
 * such product. Null paydown, which is most of them, subtracts nothing.
 *
 * Null `monthlyCents` is not a failure: a cash deal has no payment, and a loan
 * with no quotable terms is caught by its own rule rather than by this one.
 */
export function monthlyReconciles(input: {
  financedAmountCents: number;
  aprPct?: number | null;
  termMonths: number | null | undefined;
  monthlyCents: number | null | undefined;
  /** The lump the quoted payment assumes will be applied. Usually none. */
  paydownCents?: number | null;
}): boolean {
  const monthly = input.monthlyCents;
  const term = input.termMonths;
  if (monthly == null) return true;
  if (!term || term <= 0) return true;

  const financed = input.financedAmountCents;
  if (financed <= 0) return monthly <= 0;

  // What the quoted payment is actually repaying.
  const paydown = Math.max(0, Math.min(input.paydownCents ?? 0, financed));
  const repaid = financed - paydown;
  if (repaid <= 0) return true;

  // THE FLOOR: a payment cannot repay less than the money it is repaying.
  // A tenth of slack for the re-amortisation a paydown causes mid-term.
  if (monthly * term < repaid * 0.9) return false;

  // THE CEILING: what these terms, on this principal, can honestly cost — plus
  // a third for a factor's fee and structure. A dollar of absolute slack keeps
  // a tiny principal from failing on rounding alone.
  const amortised = amortisedMonthlyCents(repaid, input.aprPct ?? 0, term);
  if (amortised == null) return true;
  return monthly <= amortised * 1.35 + 100;
}

/**
 * The textbook monthly on a principal at a rate over a term, cents.
 *
 * A local copy of `loanPaymentCents`, deliberately: importing solar-money here
 * would drag the whole pricing ladder into a module the lender settings screen
 * loads in the browser, and this is four lines of arithmetic that has not
 * changed since the eighteenth century. `r = 0` is its own case because the
 * formula is 0/0 there, and 0% is the case this check is most often asked
 * about.
 */
function amortisedMonthlyCents(
  principalCents: number,
  aprPct: number,
  termMonths: number
): number | null {
  if (!(principalCents > 0) || termMonths <= 0 || aprPct < 0) return null;
  if (aprPct === 0) return principalCents / termMonths;
  const r = aprPct / 100 / 12;
  const payment = (principalCents * r) / (1 - Math.pow(1 + r, -termMonths));
  return Number.isFinite(payment) ? payment : null;
}

/** "$118,400". Local rather than imported, so this module stays dependency-free. */
function money(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
    minimumFractionDigits: 0,
  });
}
