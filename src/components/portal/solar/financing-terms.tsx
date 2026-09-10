import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import { LenderMark } from "@/components/ui/lender-mark";

/**
 * The lender side of a solar deal: who is funding it and on what terms.
 *
 * Every field here already existed in the schema and had NO user interface —
 * `CreditApplication` (lender, amount, APR, term, stipulations) was written by
 * the credit webhook and never displayed, and `SolarFinance.aprPct` /
 * `loanTermMonths` were saved but never rendered. A rep could not answer "what
 * did this customer actually get approved for" without a database query.
 *
 * Read-only on purpose. The credit decision belongs to the lender; editing it
 * here would let a rep talk a customer into terms the lender never issued.
 */

export type FinancingTerms = {
  /** cash | loan | lease | ppa */
  product: string | null;
  lender: string | null;
  /** The mark for that lender, when the name matches one of your partners. */
  lenderLogoUrl: string | null;
  creditStatus: string | null;
  amountFinancedCents: number | null;
  aprPct: number | null;
  termMonths: number | null;
  dealerFeePct: number | null;
  stipulations: string[];
  /** Loan only: cash down, reducing the financed amount. */
  downPaymentCents: number | null;
  /** Loan only: the lender's own payment figure. Never computed here. */
  loanMonthlyPaymentCents: number | null;
  /** Lease only — a lease's fixed monthly. */
  monthlyPaymentCents: number | null;
  escalatorPct: number | null;
  /** PPA only, in tenths of a cent per kWh. */
  rateMillsPerKwh: number | null;
};

const usd = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

const PRODUCT_LABEL: Record<string, string> = {
  cash: "Cash",
  loan: "Loan",
  lease: "Lease",
  ppa: "PPA",
};

/** Approved is the only state that unblocks NTP, so it is the only green one. */
const STATUS_TONE: Record<string, string> = {
  approved: "bg-emerald-100 text-emerald-700",
  conditional: "bg-amber-100 text-amber-800",
  submitted: "bg-sky-100 text-sky-700",
  declined: "bg-red-100 text-red-700",
  expired: "bg-muted text-muted-foreground",
  not_submitted: "bg-muted text-muted-foreground",
};

export function FinancingTermsPanel({ terms }: { terms: FinancingTerms }) {
  // ReactNode rather than string: the lender is a mark plus a name, and every
  // other row stays a plain string.
  const rows: { k: string; v: ReactNode }[] = [];

  if (terms.product) rows.push({ k: "Product", v: PRODUCT_LABEL[terms.product] ?? terms.product });
  if (terms.lender) {
    rows.push({
      k: "Lender",
      v: (
        <span className="flex items-center justify-end gap-2">
          <LenderMark name={terms.lender} logoUrl={terms.lenderLogoUrl} size="sm" />
          {terms.lender}
        </span>
      ),
    });
  }
  if (terms.downPaymentCents) {
    rows.push({ k: "Down payment", v: usd(terms.downPaymentCents) });
  }
  if (terms.amountFinancedCents) {
    rows.push({ k: "Amount financed", v: usd(terms.amountFinancedCents) });
  }
  if (terms.aprPct != null) rows.push({ k: "APR", v: `${terms.aprPct}%` });
  if (terms.termMonths != null) {
    // Whole years read better than "300 months", but keep the exact figure.
    const years = terms.termMonths / 12;
    const label = Number.isInteger(years)
      ? `${terms.termMonths} months · ${years} yr`
      : `${terms.termMonths} months`;
    rows.push({ k: "Term", v: label });
  }
  // The dealer fee is deliberately absent. It is the lender's own cut of the
  // price, it is set on the partner's rate sheet in Settings → Lenders, and it
  // is not something the deal page publishes — the same call the price ladder
  // on the left makes. `dealerFeePct` stays on the type because the panel is
  // handed the lender's whole terms row; nothing renders it.

  // Two different products' payments, never both at once: the loan figure comes
  // from the lender, the lease figure is the lease itself.
  if (terms.loanMonthlyPaymentCents) {
    rows.push({ k: "Monthly payment", v: `${usd(terms.loanMonthlyPaymentCents)}/mo` });
  }
  if (terms.monthlyPaymentCents) {
    rows.push({ k: "Monthly payment", v: `${usd(terms.monthlyPaymentCents)}/mo` });
  }
  if (terms.rateMillsPerKwh != null) {
    rows.push({ k: "Rate", v: `$${(terms.rateMillsPerKwh / 1000).toFixed(3)}/kWh` });
  }
  if (terms.escalatorPct != null) rows.push({ k: "Escalator", v: `${terms.escalatorPct}%/yr` });

  if (rows.length === 0 && !terms.creditStatus) {
    return (
      <p className="text-sm text-muted-foreground">
        No financing captured yet. Pick a product in the Proposal tab.
      </p>
    );
  }

  return (
    <div className="space-y-3">
      {terms.creditStatus && (
        <div className="flex items-center gap-2">
          <span className="text-xs text-muted-foreground">Credit</span>
          <span
            className={cn(
              "rounded-full px-2 py-0.5 text-[11px] font-medium capitalize",
              STATUS_TONE[terms.creditStatus] ?? "bg-muted text-muted-foreground"
            )}
          >
            {terms.creditStatus.replace(/_/g, " ")}
          </span>
        </div>
      )}

      {rows.length > 0 && (
        <dl className="divide-y divide-border text-sm">
          {rows.map((r) => (
            <div key={r.k} className="flex items-center justify-between gap-4 py-2">
              <dt className="text-muted-foreground">{r.k}</dt>
              <dd className="text-right font-medium tabular-nums">{r.v}</dd>
            </div>
          ))}
        </dl>
      )}

      {terms.stipulations.length > 0 && (
        <div>
          <div className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Stipulations to clear
          </div>
          <ul className="space-y-1">
            {terms.stipulations.map((s) => (
              <li
                key={s}
                className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-xs text-amber-900"
              >
                {s}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
