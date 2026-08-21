"use client";

import * as React from "react";
import Link from "next/link";
import { Check, Landmark, Wallet } from "lucide-react";
import type { FinanceProduct } from "@prisma/client";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { LenderMark } from "@/components/ui/lender-mark";
import { lenderProductLabel } from "@/lib/solar-lender-product";
import { PRODUCT_LABEL } from "@/lib/solar-lender-product";
import {
  basisGaps,
  CASH_OFFER_ID,
  compareOffers,
  type BasisGaps,
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
 * every shortlisted column off ONE basis — same system, same base price, same
 * adders — because columns priced on different bases are not a comparison.
 */

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const money2 = (cents: number) =>
  (cents / 100).toLocaleString("en-US", { style: "currency", currency: "USD", minimumFractionDigits: 2 });

/**
 * A product's family, said in one word, for the corner of its card.
 *
 * Tinted with a border as well as a fill: on a card that is itself tinted when
 * selected, a fill-only chip loses its edge and the four families stop being
 * distinguishable at a glance. Dark-mode pairs are explicit — a 100-level fill
 * with a 900-level text is unreadable on a dark card.
 */
const KIND_STYLE: Record<FinanceProduct, string> = {
  cash: "border-emerald-600/20 bg-emerald-50 text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300",
  loan: "border-sky-600/20 bg-sky-50 text-sky-800 dark:border-sky-400/25 dark:bg-sky-400/10 dark:text-sky-300",
  lease: "border-violet-600/20 bg-violet-50 text-violet-800 dark:border-violet-400/25 dark:bg-violet-400/10 dark:text-violet-300",
  ppa: "border-amber-600/20 bg-amber-50 text-amber-800 dark:border-amber-400/25 dark:bg-amber-400/10 dark:text-amber-300",
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
  unpricedNote,
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
  /** Why this card has no figure — the ONE thing that would give it one. */
  unpricedNote: string;
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
        "relative flex h-[8.5rem] w-[16rem] shrink-0 snap-start flex-col rounded-xl border p-3.5 text-left transition-all",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
        quoted
          ? "border-solar bg-solar/[0.06] ring-1 ring-solar"
          : shortlisted
            ? "border-foreground/30 bg-muted/60"
            : "border-border bg-card hover:-translate-y-px hover:border-foreground/20 hover:shadow-[var(--shadow-raised)]"
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="flex flex-wrap items-center gap-1">
          <span
            className={cn(
              "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
              KIND_STYLE[kind]
            )}
          >
            {PRODUCT_LABEL[kind]}
          </span>
          {/* Inside the card, never floated above it: the shelf scrolls
              sideways, and an overflow-x container clips vertically too — a
              badge hung off the top edge simply is not there. */}
          {quoted && (
            <span className="rounded bg-solar px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-solar-foreground">
              Quoted
            </span>
          )}
        </span>
        <span
          className={cn(
            "flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border transition-colors",
            shortlisted
              ? "border-foreground bg-foreground text-background"
              : "border-muted-foreground/40"
          )}
        >
          {shortlisted && <Check className="size-3" strokeWidth={3} />}
        </span>
      </div>

      <div className="mt-2 truncate text-sm font-semibold leading-snug">{title}</div>
      {terms && <div className="truncate text-[11px] text-muted-foreground">{terms}</div>}

      <div className="mt-auto">
        {headline ? (
          <>
            <div className="font-display text-xl font-semibold tabular-nums">{headline}</div>
            {headlineNote && (
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {headlineNote}
              </div>
            )}
          </>
        ) : (
          <div className="text-[11px] leading-snug text-muted-foreground">{unpricedNote}</div>
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
  /** The headline row is set larger — it is the one the customer repeats back. */
  lead?: boolean;
  cell: (r: CompareRow) => string | null;
};

const LINES: CompareLine[] = [
  {
    key: "monthly",
    label: "Monthly",
    hint: "Until the lender approves one.",
    lead: true,
    cell: (r) => (r.monthlyCents == null ? null : `${money2(r.monthlyCents)}/mo`),
  },
  {
    key: "monthly-without-paydown",
    label: "If the paydown is skipped",
    hint: "If the credit is never applied.",
    cell: (r) =>
      r.monthlyWithoutPaydownCents == null ? null : `${money2(r.monthlyWithoutPaydownCents)}/mo`,
  },
  { key: "rate", label: "$/kWh", cell: (r) => (r.rateMillsPerKwh == null ? null : `$${(r.rateMillsPerKwh / 1000).toFixed(3)}`) },
  { key: "term", label: "Term", cell: (r) => (r.termLabel === "—" ? null : r.termLabel) },
  { key: "escalator", label: "Escalator", cell: (r) => (r.escalatorPct == null ? null : `${r.escalatorPct}%/yr`) },
  {
    key: "dealer-fee",
    label: "Dealer fee",
    hint: "Why a dearer programme costs the customer more.",
    cell: (r) => (r.dealerFeePct == null ? null : `${r.dealerFeePct}%`),
  },
  { key: "sticker", label: "Sticker", cell: (r) => (r.grossPpwCents == null ? null : `$${(r.grossPpwCents / 100).toFixed(2)}/W`) },
  {
    key: "contract-price",
    label: "Contract price",
    hint: "What they sign for, adders included.",
    lead: true,
    cell: (r) => (r.contractPriceCents == null ? null : money(r.contractPriceCents)),
  },
  {
    key: "total-paid",
    label: "Total paid",
    hint: "Everything paid across the term.",
    cell: (r) => (r.totalPaidCents == null ? null : money(r.totalPaidCents)),
  },
  {
    key: "total-without-paydown",
    label: "Total if skipped",
    cell: (r) => (r.totalPaidWithoutPaydownCents == null ? null : money(r.totalPaidWithoutPaydownCents)),
  },
];

/** The rows a purchase quote is FOR. Held open while the deal cannot price. */
const MONEY_LINES = new Set(["monthly", "term", "dealer-fee", "sticker", "contract-price", "total-paid"]);

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
  blockedNote,
}: {
  rows: CompareRow[];
  quotedId: string | null;
  onQuote: (r: CompareRow) => void;
  canEdit: boolean;
  /** Set when the DEAL, not the rate sheet, is why the money rows are empty. */
  blockedNote: string | null;
}) {
  /**
   * A row every column leaves blank is dropped — EXCEPT when the deal itself is
   * what is missing.
   *
   * Dropping them then is what made this look like a bug: with no system size
   * the payment, contract price and total all vanish at once, and the table
   * that was supposed to answer "what does each of these cost a month" quietly
   * became a table of dealer fees. Kept as dashes, with the reason under them,
   * the comparison still shows what it is going to fill in.
   */
  const lines = LINES.filter(
    (l) => rows.some((r) => l.cell(r) != null) || (blockedNote != null && MONEY_LINES.has(l.key))
  );
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
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compare · {rows.length} selected
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Every column priced on the same system, base price and adders.
        </p>
      </header>

      <div className="overflow-x-auto">
        <table className="w-full min-w-max border-collapse text-sm">
          <thead>
            <tr className="border-b border-border">
              <th className="sticky left-0 z-10 w-[13.5rem] min-w-[13.5rem] border-r border-border/60 bg-card px-4 py-3 text-left">
                &nbsp;
              </th>
              {rows.map((r) => (
                <th key={r.id} className="w-[12rem] min-w-[12rem] px-4 py-3 text-left align-bottom">
                  <div className="text-[11px] text-muted-foreground">
                    {r.lenderName ?? "No lender"}
                  </div>
                  <div className="text-sm font-semibold leading-snug">{r.label}</div>
                  {r.id === cheapest && (
                    <span className="mt-1 inline-block rounded border border-emerald-600/20 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
                      Lowest total
                    </span>
                  )}
                </th>
              ))}
              {/* Takes the slack. Without it a single shortlisted programme is
                  stretched across the whole card, and one $204.32 marooned in
                  a band of white does not read as a column of a comparison. */}
              <th aria-hidden className="w-full" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line, i) => (
              <tr
                key={line.key}
                data-testid={`compare-${line.key}`}
                className={cn("border-t border-border/50", i % 2 === 1 && "bg-muted/25")}
              >
                {/* The zebra is applied to the row AND repeated on the sticky
                    header cell. `even:` would key off the CELL's position among
                    its siblings — it is always the first — so the frozen column
                    would stay one flat colour while the rows behind it striped,
                    and the stripes would then slide under it as the table
                    scrolls. Opaque either way: the cell is what the scrolling
                    columns pass behind. */}
                <th
                  scope="row"
                  className={cn(
                    "sticky left-0 z-10 min-w-[13.5rem] border-r border-border/60 px-4 py-2 text-left align-top text-[11px] font-medium text-muted-foreground",
                    i % 2 === 1 ? "bg-[color-mix(in_oklch,var(--card),var(--muted)_25%)]" : "bg-card"
                  )}
                >
                  {line.label}
                  {line.hint && <span className="mt-0.5 block max-w-[11rem] opacity-70">{line.hint}</span>}
                </th>
                {rows.map((r) => (
                  <td
                    key={r.id}
                    className={cn(
                      "px-4 py-2 align-top tabular-nums",
                      line.lead && "font-display text-base font-semibold"
                    )}
                  >
                    {line.cell(r) ?? <span className="text-sm font-normal text-muted-foreground">—</span>}
                  </td>
                ))}
                <td aria-hidden />
              </tr>
            ))}
          </tbody>
          {canEdit && (
            <tfoot>
              <tr className="border-t border-border">
                <th className="sticky left-0 z-10 min-w-[13.5rem] border-r border-border/60 bg-card px-4 py-3" />
                {rows.map((r) => (
                  <td key={r.id} className="px-4 py-3">
                    {r.id === quotedId ? (
                      <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-solar">
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
                <td aria-hidden />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {blockedNote && (
        <p className="border-t border-amber-300/70 bg-amber-50 px-4 py-2.5 text-[11px] text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          {blockedNote}
        </p>
      )}

      {mixedOwnership && (
        <p className="border-t border-border/70 bg-muted/20 px-4 py-2.5 text-[11px] text-muted-foreground">
          A lease or PPA buys electricity, not the array — its total is not a price for the same
          thing a purchase column buys, so the smaller number is not automatically the better deal.
        </p>
      )}
    </section>
  );
}

/**
 * Why THIS card carries no figure — the deal, the company's pricing, or the
 * programme itself, in the order a rep can act on them.
 *
 * A lease or PPA is quoted off its own rate sheet and needs no price per watt,
 * so it is never told to go and set one.
 */
function unpricedNote(kind: FinanceProduct, gaps: BasisGaps): string {
  if (gaps.systemSize) return "Needs a system size — the roof has not been drawn yet.";
  if ((kind === "cash" || kind === "loan") && gaps.pricePerWatt) {
    return "Needs a base price — set one in System price above.";
  }
  return "Not priced yet — the terms on this programme are incomplete.";
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
  onOpenDesign,
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
  /** Takes the rep to the step that fixes an empty comparison. */
  onOpenDesign?: () => void;
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

  /**
   * Nothing on this shelf can be priced, and it is the DEAL that is missing.
   *
   * Said once, above every card, because it is one fix on another screen — not
   * a fault of any lender's terms. Only the system size gets the banner: a
   * missing base price is fixed in the card directly above, where the card note
   * already points.
   */
  const gaps = basisGaps(basis);
  const blockedNote = gaps.systemSize
    ? "Every payment reads — because this deal has no system size yet. Draw the roof on System design and each column prices itself."
    : null;

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
        unpricedNote={unpricedNote(kind, gaps)}
        shortlisted={shortlist.includes(id)}
        quoted={quotedId === id}
        disabled={!canEdit}
        onToggle={() => onToggle(id)}
      />
    );
  };

  return (
    <div className="space-y-4">
      {/* The one screen that answers "what does each of these cost a month"
          cannot answer it without an array to multiply by. Said here, at the
          top, with the way out attached — not left to be inferred from a table
          of dashes further down. */}
      {gaps.systemSize && (
        <div className="max-w-3xl rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
          <strong>No system size yet</strong>, so nothing below can be priced — a monthly payment
          is the array multiplied by a rate, and this deal has no array on it. Draw the roof on{" "}
          <strong>System design</strong> and every card and column fills in.
          {onOpenDesign && (
            <div className="mt-2">
              <Button size="sm" variant="outline" onClick={onOpenDesign}>
                Open System design
              </Button>
            </div>
          )}
        </div>
      )}

      <section className="overflow-hidden rounded-xl border border-border bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Ways to pay
          </h4>
          <p className="text-[11px] text-muted-foreground">
            Tick any two to compare them. Cash pays the base price; each lender adds its own dealer
            fee.
          </p>
        </header>

        <div className="space-y-4 p-4">
          <section aria-label="Paid outright" className="space-y-2">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-md bg-muted text-muted-foreground">
                <Wallet className="size-3.5" />
              </span>
              <span className="text-xs font-semibold uppercase tracking-wide">Paid outright</span>
              <span className="text-[11px] text-muted-foreground">no lender</span>
            </div>
            <ShelfRow>
              {cardFor(CASH_OFFER_ID, "Cash", "cash", "Paid in full. No lender, so no dealer fee.")}
            </ShelfRow>
          </section>

          {lenders.length === 0 && (
            <p className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              No lenders set up yet, so cash is the only way to quote this deal.{" "}
              <Link href="/portal/settings/solar-lenders" className="font-medium underline underline-offset-2">
                Add your lenders →
              </Link>
            </p>
          )}

          {lenders.map((l) => {
            const sheet = byLender.get(l.id) ?? [];
            return (
              // A landmark per partner: two lenders can publish programmes whose
              // terms read identically, so "25 yr · 3.99% · fee 28%" only names one
              // offer once you know whose shelf it is on.
              <section key={l.id} aria-label={l.name} className="space-y-2 border-t border-border/60 pt-4">
                <div className="flex items-center gap-2">
                  <LenderMark name={l.name} logoUrl={l.logoUrl} size="sm" />
                  <span className="text-xs font-semibold uppercase tracking-wide">
                    {l.name}
                    {l.isActive ? "" : <span className="text-muted-foreground"> · retired</span>}
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
                  <ShelfRow>
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
                  </ShelfRow>
                )}
              </section>
            );
          })}
        </div>
      </section>

      {selected.length > 0 ? (
        <CompareTable
          rows={selected}
          quotedId={quotedId}
          onQuote={onQuote}
          canEdit={canEdit}
          blockedNote={blockedNote}
        />
      ) : (
        <p className="flex items-center gap-1.5 rounded-lg border border-dashed border-border px-3 py-2.5 text-[11px] text-muted-foreground">
          <Landmark className="size-3.5" /> Pick two or more programmes above to compare what each one
          costs.
        </p>
      )}
    </div>
  );
}

/**
 * A sideways-scrolling row of cards.
 *
 * `py-1 -my-1` rather than plain overflow: the cards lift a pixel on hover and
 * carry a shadow, and an overflow-x container clips vertically too — without
 * the padding the lift is sheared off at the top edge.
 */
function ShelfRow({ children }: { children: React.ReactNode }) {
  return <div className="-my-1 flex snap-x gap-3 overflow-x-auto py-1">{children}</div>;
}
