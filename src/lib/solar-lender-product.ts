import type { FinanceProduct } from "@prisma/client";

/**
 * How a lender product reads to a human.
 *
 * Shared by the settings list and the deal-side picker deliberately: a rep
 * choosing "25 yr · 4.99% · fee 18%" on a deal has to be able to find that
 * exact line on the rate sheet, and two formatters would drift into two
 * vocabularies for one row.
 */

export type ProductForLabel = {
  product: FinanceProduct;
  name?: string | null;
  aprPct?: number | null;
  termMonths?: number | null;
  dealerFeePct?: number | null;
  leaseRateCentsPerKwMonth?: number | null;
  rateMillsPerKwh?: number | null;
  escalatorPct?: number | null;
  termYears?: number | null;
};

/** Trailing zeros dropped: "4.99%", "18%", "2.9%" — never "18.00%". */
const pct = (n: number) => `${Number(n.toFixed(2))}%`;

/**
 * A loan's term is stored in months because that is how lenders quote it, but
 * "300 mo" is not how anybody says it. Whole years read as years; anything else
 * keeps its months rather than being rounded into a lie.
 */
function loanTerm(months: number): string {
  return months % 12 === 0 ? `${months / 12} yr` : `${months} mo`;
}

export function lenderProductLabel(p: ProductForLabel): string {
  if (p.name?.trim()) return p.name.trim();

  const parts: string[] = [];
  if (p.product === "loan") {
    if (p.termMonths != null) parts.push(loanTerm(p.termMonths));
    if (p.aprPct != null) parts.push(pct(p.aprPct));
    if (p.dealerFeePct != null) parts.push(`fee ${pct(p.dealerFeePct)}`);
  } else {
    if (p.termYears != null) parts.push(`${p.termYears} yr`);
    if (p.escalatorPct != null) parts.push(`esc ${pct(p.escalatorPct)}`);
    if (p.product === "lease" && p.leaseRateCentsPerKwMonth != null) {
      parts.push(`$${(p.leaseRateCentsPerKwMonth / 100).toFixed(2)}/kW-mo`);
    }
    // Mills are tenths of a cent, so $/kWh carries three decimals: 145 → $0.145.
    if (p.product === "ppa" && p.rateMillsPerKwh != null) {
      parts.push(`$${(p.rateMillsPerKwh / 1000).toFixed(3)}/kWh`);
    }
  }

  // A row saved before its terms were filled in still has to render as
  // something a person can click on.
  return parts.length > 0 ? parts.join(" · ") : PRODUCT_LABEL[p.product];
}

export const PRODUCT_LABEL: Record<FinanceProduct, string> = {
  cash: "Cash",
  loan: "Loan",
  lease: "Lease",
  ppa: "PPA",
};

/** The products a lender can carry. Cash has no lender, so it is not one. */
export const LENDER_PRODUCT_KINDS = ["loan", "lease", "ppa"] as const;
export type LenderProductKind = (typeof LENDER_PRODUCT_KINDS)[number];
