"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Landmark } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LenderMark } from "@/components/ui/lender-mark";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { PRODUCT_LABEL } from "@/lib/solar-lender-product";
import {
  CASH_OFFER_ID,
  compareOffers,
  type CompareBasis,
  type CompareRow,
  type Offer,
  type OfferProduct,
} from "@/lib/solar-compare";

/**
 * Every way this deal could be paid for, side by side.
 *
 * A rep does not sell "a loan" — she sells Amos at 30 years against Amos at 20
 * against Climate First, and the homeowner asks what each one costs. The step
 * used to open on four abstract product TYPES, which meant the actual offers
 * were two dropdowns deep and could only ever be looked at one at a time; there
 * was no screen anywhere that answered "which of these is cheaper".
 *
 * So the rate sheets are the interface. Each lender gets a shelf of its own
 * programmes, any number of them can be shortlisted, and the comparison prices
 * every shortlisted column off ONE basis — same system, same adders, same net
 * target — because columns priced on different bases are not a comparison.
 */

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const money2 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/** A product's family, said in one word, for the corner of its card. */
const KIND_STYLE: Record<FinanceProduct, string> = {
  cash: "bg-emerald-100 text-emerald-900",
  loan: "bg-sky-100 text-sky-900",
  lease: "bg-violet-100 text-violet-900",
  ppa: "bg-amber-100 text-amber-900",
};

export type OfferLender = {
  id: string;
  name: string;
  isActive: boolean;
  logoUrl: string | null;
};

/**
 * One programme on the shelf.
 *
 * Clicking the body shortlists it; that is the "check". Which one the deal is
 * actually QUOTED on is decided in the comparison below, deliberately — a card
 * that both shortlists and commits on one click is a card a rep re-prices a
 * deal with by accident.
 */
function OfferCard({
  title,
  kind,
  terms,
  headline,
  headlineNote,
  shortlisted,
  quoted,
  disabled,
  onToggle,
}: {
  title: string;
  kind: FinanceProduct;
  terms: string | null;
  headline: string | null;
  headlineNote: string | null;
  shortlisted: boolean;
  quoted: boolean;
  disabled: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={shortlisted}
      className={cn(
        "flex w-[15rem] shrink-0 snap-start flex-col gap-1 rounded-xl border p-3 text-left transition-colors disabled:opacity-60",
        quoted
          ? "border-foreground ring-1 ring-foreground"
          : shortlisted
            ? "border-foreground bg-muted"
            : "border-border hover:bg-muted/50"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-1">
          <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide", KIND_STYLE[kind])}>
            {PRODUCT_LABEL[kind]}
          </span>
          {/* Inside the card, never floated above it: the shelf scrolls
              sideways, and an overflow-x container clips vertically too — a
              badge hung off the top edge simply is not there. */}
          {quoted && (
            <span className="rounded bg-foreground px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-background">
              Quoted
            </span>
          )}
        </span>
        <span
          className={cn(
            "flex size-4 items-center justify-center rounded border",
            shortlisted ? "border-foreground bg-foreground text-background" : "border-muted-foreground/40"
          )}
        >
          {shortlisted && <Check className="size-3" strokeWidth={3} />}
        </span>
      </div>

      <div className="text-sm font-semibold leading-snug">{title}</div>
      {terms && <div className="text-[11px] text-muted-foreground">{terms}</div>}

      <div className="mt-auto pt-1.5">
        {headline ? (
          <>
            <div className="font-display text-lg font-semibold tabular-nums">{headline}</div>
            {headlineNote && <div className="text-[10px] text-muted-foreground">{headlineNote}</div>}
          </>
        ) : (
          <div className="text-[11px] text-muted-foreground">
            Not priced yet — the terms on this programme are incomplete.
          </div>
        )}
      </div>

    </button>
  );
}

/** The rows of the comparison, in the order a homeowner asks about them. */
type CompareLine = {
  /** Stable handle for one row. Row LABELS appear inside other rows' hints. */
  key: string;
  label: string;
  hint?: string;
  cell: (r: CompareRow) => string | null;
};

const LINES: CompareLine[] = [
  {
    key: "monthly",
    label: "Monthly",
    hint: "Estimated. A lender's approved figure replaces it.",
    cell: (r) => (r.monthlyCents == null ? null : `${money2(r.monthlyCents)}/mo`),
  },
  {
    key: "monthly-without-paydown",
    label: "If the paydown is skipped",
    hint: "What the payment becomes when the credit is never applied.",
    cell: (r) =>
      r.monthlyWithoutPaydownCents == null ? null : `${money2(r.monthlyWithoutPaydownCents)}/mo`,
  },
  { key: "rate", label: "$/kWh", cell: (r) => (r.rateMillsPerKwh == null ? null : `$${(r.rateMillsPerKwh / 1000).toFixed(3)}`) },
  { key: "term", label: "Term", cell: (r) => (r.termLabel === "—" ? null : r.termLabel) },
  { key: "escalator", label: "Escalator", cell: (r) => (r.escalatorPct == null ? null : `${r.escalatorPct}%/yr`) },
  {
    key: "dealer-fee",
    label: "Dealer fee",
    hint: "The lender's cut of the sticker. It is why the same system costs more on a dearer programme.",
    cell: (r) => (r.dealerFeePct == null ? null : `${r.dealerFeePct}%`),
  },
  { key: "sticker", label: "Sticker", cell: (r) => (r.grossPpwCents == null ? null : `$${(r.grossPpwCents / 100).toFixed(2)}/W`) },
  {
    key: "contract-price",
    label: "Contract price",
    hint: "What the customer signs for, adders included.",
    cell: (r) => (r.contractPriceCents == null ? null : money(r.contractPriceCents)),
  },
  {
    key: "total-paid",
    label: "Total paid",
    hint: "Everything handed over across the whole term.",
    cell: (r) => (r.totalPaidCents == null ? null : money(r.totalPaidCents)),
  },
  {
    key: "total-without-paydown",
    label: "Total if skipped",
    cell: (r) => (r.totalPaidWithoutPaydownCents == null ? null : money(r.totalPaidWithoutPaydownCents)),
  },
];

/**
 * The comparison itself.
 *
 * Scrolls sideways rather than wrapping: four programmes on a laptop is normal,
 * and a table that reflows into stacked blocks stops being a comparison the
 * moment the reader can no longer see two numbers at once. The label column
 * stays put so the fifth column still knows what it is looking at.
 *
 * A line every column leaves blank is dropped — a pure-lease shortlist should
 * not carry four empty purchase rows.
 */
function CompareTable({
  rows,
  quotedId,
  onQuote,
  canEdit,
}: {
  rows: CompareRow[];
  quotedId: string | null;
  onQuote: (r: CompareRow) => void;
  canEdit: boolean;
}) {
  const lines = LINES.filter((l) => rows.some((r) => l.cell(r) != null));
  /**
   * The cheapest column, but ONLY when every column buys the same thing.
   *
   * A lease's 25-year total and a loan's are both "what you hand over", and
   * they are not comparable: at the end of one the customer owns an array and
   * at the end of the other they own nothing. Badging the lease as the winner
   * because its number is smaller would be the most expensive kind of true.
   */
  const cheapest = React.useMemo(() => {
    const priced = rows.filter((r) => r.totalPaidCents != null);
    if (priced.length < 2) return null;
    if (rows.some((r) => r.product === "lease" || r.product === "ppa")) return null;
    return priced.reduce((a, b) => (a.totalPaidCents! <= b.totalPaidCents! ? a : b)).id;
  }, [rows]);

  /** Said once, under the table, whenever ownership is not the same everywhere. */
  const mixedOwnership =
    rows.some((r) => r.product === "lease" || r.product === "ppa") &&
    rows.some((r) => r.product === "cash" || r.product === "loan");

  return (
    <div className="rounded-xl border border-border">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-3 py-2">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compare · {rows.length} selected
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Every column priced on the same system and adders.
        </p>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr>
              <th className="sticky left-0 z-10 bg-card px-3 py-2 text-left text-[11px] font-medium text-muted-foreground">
                &nbsp;
              </th>
              {rows.map((r) => (
                <th key={r.id} className="min-w-[10rem] px-3 py-2 text-left align-bottom">
                  <div className="flex items-center gap-1.5">
                    {r.lenderName ? (
                      <span className="truncate text-[11px] text-muted-foreground">{r.lenderName}</span>
                    ) : (
                      <span className="text-[11px] text-muted-foreground">No lender</span>
                    )}
                  </div>
                  <div className="text-sm font-semibold leading-snug">{r.label}</div>
                  {r.id === cheapest && (
                    <span className="mt-1 inline-block rounded bg-emerald-100 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-900">
                      Lowest total
                    </span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.key} data-testid={`compare-${line.key}`} className="border-t border-border/60">
                <th
                  scope="row"
                  className="sticky left-0 z-10 bg-card px-3 py-1.5 text-left align-top text-[11px] font-medium text-muted-foreground"
                >
                  {line.label}
                  {line.hint && <span className="block max-w-[12rem] opacity-70">{line.hint}</span>}
                </th>
                {rows.map((r) => (
                  <td key={r.id} className="px-3 py-1.5 tabular-nums">
                    {line.cell(r) ?? <span className="text-muted-foreground">—</span>}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
          {canEdit && (
            <tfoot>
              <tr className="border-t border-border">
                <th className="sticky left-0 z-10 bg-card px-3 py-2" />
                {rows.map((r) => (
                  <td key={r.id} className="px-3 py-2">
                    {r.id === quotedId ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold">
                        <Check className="size-3.5" /> Quoted
                      </span>
                    ) : (
                      <Button
                        size="sm"
                        variant="outline"
                        // Five buttons reading "Quote this" are five identical
                        // announcements. The visible text is kept inside the
                        // name so speech control still works on what is read.
                        aria-label={`Quote this: ${r.lenderName ? `${r.lenderName} ` : ""}${r.label}`}
                        onClick={() => onQuote(r)}
                      >
                        Quote this
                      </Button>
                    )}
                  </td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {mixedOwnership && (
        <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
          A lease or PPA buys electricity, not the array — its total is not a price for the same
          thing a purchase column buys, so the smaller number is not automatically the better deal.
        </p>
      )}
    </div>
  );
}

export function FinanceOffers({
  lenders,
  products,
  basis,
  shortlist,
  onToggle,
  quotedId,
  onQuote,
  canEdit,
}: {
  lenders: OfferLender[];
  products: OfferProduct[];
  basis: CompareBasis;
  shortlist: string[];
  onToggle: (id: string) => void;
  /** The offer this deal is quoted on — CASH_OFFER_ID, a product id, or null. */
  quotedId: string | null;
  onQuote: (r: CompareRow) => void;
  canEdit: boolean;
}) {
  const byLender = React.useMemo(() => {
    const m = new Map<string, OfferProduct[]>();
    for (const p of products) {
      const list = m.get(p.lenderId);
      if (list) list.push(p);
      else m.set(p.lenderId, [p]);
    }
    return m;
  }, [products]);

  // Priced once, for the cards AND the table, so a card can never disagree with
  // the column it opens.
  const priced = React.useMemo(() => {
    const offers: Offer[] = [{ kind: "cash" }, ...products];
    const rows = compareOffers(offers, basis);
    return new Map(rows.map((r) => [r.id, r]));
  }, [products, basis]);

  const selected = shortlist
    .map((id) => priced.get(id))
    .filter((r): r is CompareRow => r != null);

  const cardFor = (id: string, title: string, kind: FinanceProduct, terms: string | null) => {
    const row = priced.get(id);
    const headline =
      row == null
        ? null
        : kind === "cash"
          ? row.contractPriceCents != null
            ? money(row.contractPriceCents)
            : null
          : row.monthlyCents != null
            ? `${money2(row.monthlyCents)}/mo`
            : row.rateMillsPerKwh != null
              ? `$${(row.rateMillsPerKwh / 1000).toFixed(3)}/kWh`
              : null;
    const note =
      kind === "cash"
        ? "contract price"
        : row?.fromFactor
          ? "from the rate sheet's factor"
          : row?.monthlyCents != null
            ? "estimated monthly"
            : row?.rateMillsPerKwh != null
              ? "escalates each year"
              : null;

    return (
      <OfferCard
        key={id}
        title={title}
        kind={kind}
        terms={terms}
        headline={headline}
        headlineNote={note}
        shortlisted={shortlist.includes(id)}
        quoted={quotedId === id}
        disabled={!canEdit}
        onToggle={() => onToggle(id)}
      />
    );
  };

  return (
    <div className="space-y-4">
      <div className="flex snap-x gap-3 overflow-x-auto pb-1">
        {cardFor(CASH_OFFER_ID, "Cash", "cash", "Paid in full. No lender, so no dealer fee.")}
      </div>

      {lenders.length === 0 && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          No lenders set up yet, so cash is the only way to quote this deal.{" "}
          <Link href="/portal/settings/solar-lenders" className="font-medium underline underline-offset-2">
            Add your lenders →
          </Link>
        </div>
      )}

      {lenders.map((l) => {
        const sheet = byLender.get(l.id) ?? [];
        return (
          // A landmark per partner: two lenders can publish programmes whose
          // terms read identically, so "25 yr · 3.99% · fee 28%" only names one
          // offer once you know whose shelf it is on.
          <section key={l.id} aria-label={l.name} className="space-y-2">
            <div className="flex items-center gap-2">
              <LenderMark name={l.name} logoUrl={l.logoUrl} size="sm" />
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                {l.name}
                {l.isActive ? "" : " · retired"}
              </span>
              {sheet.length > 0 && (
                <span className="text-[11px] text-muted-foreground">
                  {sheet.length} programme{sheet.length === 1 ? "" : "s"}
                </span>
              )}
            </div>

            {sheet.length === 0 ? (
              <p className="text-[11px] text-muted-foreground">
                Nothing on this rate sheet yet.{" "}
                <Link
                  href="/portal/settings/solar-lenders"
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  Add {l.name}&rsquo;s terms
                </Link>{" "}
                and they appear here.
              </p>
            ) : (
              <div className="flex snap-x gap-3 overflow-x-auto pb-1">
                {sheet.map((p) =>
                  cardFor(
                    p.id,
                    p.label,
                    p.product,
                    [
                      p.isActive ? null : "retired",
                      lenderProductLabel(p) === p.label ? null : lenderProductLabel(p),
                    ]
                      .filter(Boolean)
                      .join(" · ") || null
                  )
                )}
              </div>
            )}
          </section>
        );
      })}

      {selected.length > 0 ? (
        <CompareTable rows={selected} quotedId={quotedId} onQuote={onQuote} canEdit={canEdit} />
      ) : (
        <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
          <Landmark className="size-3.5" /> Pick two or more programmes above to compare what each one
          costs.
        </p>
      )}
    </div>
  );
}
