import type { ProposalPaymentOption, SavingsModel } from "@/lib/solar-proposal";

/**
 * What the cover of a solar proposal is allowed to promise, and what the
 * lifetime figure is allowed to be called.
 *
 * Both answers are decisions about HONESTY rather than about layout, which is
 * why they live here as pure functions instead of inside the document: they are
 * the two places where a proposal can most easily tell a homeowner something
 * that is not true of their deal, and they are worth a test each.
 */

/** What the household pays for power each month before anything is installed. */
export function monthlyToday(
  avgMonthlyBillCents: number | null | undefined,
  savings: SavingsModel,
): number {
  // The reported bill is the number the customer recognises, so it wins. It is
  // frequently absent — nothing has collected it since the intake rewrite — and
  // the model's first year always exists, which is why the fallback is safe.
  if (avgMonthlyBillCents != null && avgMonthlyBillCents > 0) return avgMonthlyBillCents;
  const year1 = savings.years[0];
  return year1 ? Math.round(year1.utilityCostCents / 12) : 0;
}

export type CoverPitch =
  /** Financed, and the new monthly genuinely lands under the old bill. */
  | { kind: "monthly-swap"; todayCents: number; afterCents: number }
  /** Bought outright: one cheque, then a much smaller bill. */
  | { kind: "cash-then"; todayCents: number; afterCents: number; priceCents: number | null }
  /** Everything else. The cover leads on the system, not on the money. */
  | { kind: "coverage" };

/**
 * The strongest statement that is TRUE of this deal.
 *
 * The tempting design is a fixed "here is your new monthly payment" cover, and
 * it is wrong. A financed deal can quote a payment ABOVE the bill it replaces —
 * prod has one: an 11 kW system on a 30-year programme at roughly $330 a month
 * against a $180 bill. A cover template that always leads on the monthly hands
 * that homeowner the worst reading of their own proposal in the largest type on
 * the page, and it does it automatically, on every deal, forever.
 *
 * So when the money is not the strong part, the cover does not pretend it is.
 * It leads on coverage and ownership, and the money is argued properly further
 * down where the assumptions sit beside it.
 */
export function coverPitch(args: {
  billCents: number;
  option: ProposalPaymentOption;
  savings: SavingsModel;
  /** The contract price, when the document knows it. Cash covers quote it. */
  priceCents?: number | null;
}): CoverPitch {
  const { billCents, option } = args;
  const after = option.postSolarMonthlyCents;

  // No monthly to quote means the system was bought outright. There is no
  // payment to compare, so the comparison is the bill itself, before and after.
  if (option.monthlyCents == null) {
    return {
      kind: "cash-then",
      todayCents: billCents,
      afterCents: after,
      priceCents: args.priceCents ?? null,
    };
  }

  const afterAll = option.monthlyCents + after;

  // Strictly below. A payment that merely TIES today's bill is not a saving,
  // and a cover that draws two equal bars beside the words "what changes" has
  // answered its own question with "nothing".
  if (billCents > 0 && afterAll < billCents) {
    return { kind: "monthly-swap", todayCents: billCents, afterCents: afterAll };
  }

  return { kind: "coverage" };
}

export type LifetimeFigure = {
  /** Follows the sign: a negative result is a cost, not a "negative saving". */
  label: string;
  /** Always positive. The label carries the direction. */
  cents: number;
  /** `good` earns the accent colour. `plain` deliberately does not. */
  tone: "good" | "plain";
  paybackYear: number | null;
  negative: boolean;
};

/**
 * The lifetime number, named for what it actually is.
 *
 * `netSavingsCents` is legitimately negative on plenty of financed deals, and
 * the document used to print it verbatim under the words "net saving" — an
 * oxymoron, in accent orange, at the largest size on the page. Nothing here
 * hides the result or changes its magnitude: the label follows the sign, the
 * figure is stated positively so it reads as an amount rather than an error,
 * and the accent is withheld so a loss does not wear the colour of a win.
 */
export function lifetimeFigure(savings: SavingsModel): LifetimeFigure {
  const horizon = savings.years.length;
  const negative = savings.netSavingsCents < 0;
  return {
    label: `Projected ${horizon}-year net ${negative ? "cost" : "saving"}`,
    cents: Math.abs(savings.netSavingsCents),
    tone: negative ? "plain" : "good",
    paybackYear: negative ? null : savings.paybackYear,
    negative,
  };
}

/**
 * The sentence under the lifetime figure. Different argument, same numbers.
 *
 * The ownership claim is only made where the years do not pay the system back:
 * a household reading that the bill they avoid falls short is owed the other
 * half of what they got for the money. Where the figure is a saving the number
 * has already made the argument.
 */
export function lifetimeNote(f: LifetimeFigure, utilityName: string | null): string {
  const utility = utilityName ?? "your utility";
  if (f.negative) {
    return (
      `Over ${f.label.match(/\d+/)?.[0] ?? "25"} years the utility bill you avoid does not fully ` +
      `cover the system. You own it outright, it carries its manufacturer warranties, and it ` +
      `transfers with the house if you sell.`
    );
  }
  const payback =
    f.paybackYear != null ? ` On the assumptions listed, it pays for itself in year ${f.paybackYear}.` : "";
  return `After paying for the system, against staying with ${utility} for the same period.${payback}`;
}
