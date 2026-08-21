import type { FinanceProduct } from "@prisma/client";
import { PRODUCT_LABEL } from "@/lib/solar-lender-product";

/**
 * The FINANCING tile in a solar deal's header row.
 *
 * Pulled out of the deal page because the question it answers — "how is this
 * deal being paid for?" — has four different right answers and a wrong one
 * that shipped: the tile used to be headed "Lender", could only ever name one,
 * and so put a CASH deal on "Not selected". A deal with no lender by
 * definition read as a loan nobody had arranged yet.
 *
 * The product leads the hint on anything financed, because a partner's name on
 * its own does not say whether the customer is buying the system or renting it.
 */
export type FinancingCard = {
  label: "Financing";
  /** `null` keeps the header slot and renders a muted placeholder. */
  value: string | null;
  hint: string;
};

export function financingCard({
  product,
  creditLender,
  creditStatus,
  designLender,
}: {
  /**
   * `SolarFinance.product`, or null when no finance row exists. The row is
   * written only when the proposal's Financing step is saved, so `cash` is a
   * decision somebody made rather than the column default sitting unanswered.
   */
  product: FinanceProduct | null;
  /** Lender named on the best credit application, if any. */
  creditLender: string | null;
  /** That application's status, underscores already stripped. */
  creditStatus: string | null;
  /** Lender chosen on the design — our intent, until a lender answers. */
  designLender: string | null;
}): FinancingCard {
  // No lender, no application, nothing outstanding. Say so outright instead of
  // leaving the slot looking half-filled.
  if (product === "cash") {
    return { label: "Financing", value: "Cash", hint: "Paid in full · no lender" };
  }
  // A credit application wins over the design's choice: that is a decision a
  // lender actually made. A blank lender name — the webhook can write one —
  // falls through rather than rendering an empty tile that claims to be filled.
  const lender = creditLender?.trim() || designLender?.trim() || null;
  const status =
    creditLender?.trim() && creditStatus
      ? creditStatus.charAt(0).toUpperCase() + creditStatus.slice(1)
      : lender
        ? "No application yet"
        : "No lender selected";
  return {
    label: "Financing",
    value: lender,
    hint: [product ? PRODUCT_LABEL[product] : null, status].filter(Boolean).join(" · "),
  };
}
