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
 *
 * The card names its own lender. The shelf used to be one row per partner,
 * each scrolling sideways, which stacked cash above Amos above Climate First
 * and put half of each row off the edge of the screen — three headings and a
 * lot of white to compare three cards. They lie in one wrapped grid now, so
 * the card is the only thing left that can say whose programme it is.
 */
function OfferCard({
  title,
  kind,
  terms,
  lenderName,
  logoUrl,
  headline,
  headlineNote,
  creditNote,
  capNote,
  capBroken,
  unpricedNote,
  shortlisted,
  quoted,
  disabled,
  onToggle,
}: {
  title: string;
  kind: FinanceProduct;
  terms: string | null;
  /** Null on cash — it is the one way to pay that has no lender behind it. */
  lenderName: string | null;
  logoUrl: string | null;
  headline: string | null;
  headlineNote: string | null;
  /**
   * THE SAME PAYMENT WITH NO TAX CREDIT AGAINST IT.
   *
   * Under the quoted figure rather than instead of it, because the two are both
   * true and the document says both: the proposal opens on the headline and its
   * tax-credit switch shows this one. A card carrying only the credited figure
   * would leave a rep with nothing to answer "and if I don't get the credit?"
   * with. Null wherever it would repeat the headline — see `CompareRow`.
   */
  creditNote: string | null;
  /** Set only where the lender's maximum price per watt moved this figure. */
  capNote: string | null;
  /** The cap could not be honoured — the adders alone are over it. */
  capBroken: boolean;
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
      // Named explicitly, lender first. Two partners can publish programmes
      // whose terms read identically — "25 yr · 3.99% · fee 28%" only names one
      // offer once you know whose it is, and the per-lender landmark that used
      // to supply that is gone with the stacked rows.
      aria-label={[lenderName ?? "No lender", title, terms, quoted ? "Quoted" : null]
        .filter(Boolean)
        .join(" · ")}
      className={cn(
        "relative flex min-h-[9.5rem] w-full flex-col rounded-xl border p-3.5 text-left transition-all",
        "focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60",
        quoted
          ? "border-solar bg-solar/[0.06] ring-1 ring-solar"
          : shortlisted
            ? "border-foreground/30 bg-muted/60"
            : "border-border bg-card hover:-translate-y-px hover:border-foreground/20 hover:shadow-[var(--shadow-raised)]"
      )}
    >
      <div className="flex items-center gap-2">
        {lenderName ? (
          <LenderMark name={lenderName} logoUrl={logoUrl} size="sm" />
        ) : (
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground">
            <Wallet className="size-3.5" />
          </span>
        )}
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
          {lenderName ?? "No lender"}
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

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            KIND_STYLE[kind]
          )}
        >
          {PRODUCT_LABEL[kind]}
        </span>
        {quoted && (
          <span className="rounded bg-solar px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-solar-foreground">
            Quoted
          </span>
        )}
      </div>

      <div className="mt-1.5 truncate text-sm font-semibold leading-snug">{title}</div>
      {terms && <div className="truncate text-[11px] text-muted-foreground">{terms}</div>}

      <div className="mt-auto pt-2">
        {headline ? (
          <>
            <div className="font-display text-xl font-semibold tabular-nums">{headline}</div>
            {headlineNote && (
              <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {headlineNote}
              </div>
            )}
            {/* Muted, not green: it is the HIGHER figure now — what this costs
                if the credit never lands — and colouring a worse number as
                good news is how a rep reads past it. */}
            {creditNote && (
              <div className="mt-0.5 text-[11px] tabular-nums text-muted-foreground">
                {creditNote}
              </div>
            )}
            {capNote && (
              <div
                className={cn(
                  "mt-1 inline-block max-w-full truncate rounded px-1.5 py-0.5 text-[10px] font-medium",
                  capBroken
                    ? "bg-red-50 text-red-800 dark:bg-red-500/10 dark:text-red-300"
                    : "bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-300"
                )}
              >
                {capNote}
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
    hint: "The credits this job earns are already against the loan.",
    lead: true,
    cell: (r) => (r.monthlyCents == null ? null : `${money2(r.monthlyCents)}/mo`),
  },
  {
    // Directly under the payment it is the other reading of. Only the columns
    // that actually earn credits carry it, and only where it comes out above
    // the figure above — see `withoutCreditsMonthlyCents`.
    key: "monthly-without-credits",
    label: "If they never claim it",
    hint: "The whole contract financed, with no tax credit against it.",
    cell: (r) =>
      r.withoutCreditsMonthlyCents == null ? null : `${money2(r.withoutCreditsMonthlyCents)}/mo`,
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
    // Shown only where a ceiling is in play. Everywhere else the customer's
    // price absorbs a dearer lender and this figure sits still at the base
    // price, so a row repeating it in every column teaches nothing; under a
    // cap it is the number that MOVES, and the one a rep is trading away.
    key: "you-keep",
    label: "You keep",
    hint: "Your gross per watt after this lender's cut and the adders.",
    cell: (r) =>
      r.capped && r.netPpwCents != null ? `$${(r.netPpwCents / 100).toFixed(2)}/W` : null,
  },
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
 * The comparison itself: one column per shortlisted programme.
 *
 * It was a table — a frozen label column with the offers running off to the
 * right — which is the right shape for a spreadsheet and the wrong one for the
 * moment this screen exists for, which is a rep turning the laptop around and
 * saying "here are your three choices". A homeowner reads a column, not a row:
 * whose money it is, what it costs a month, what they sign for, and a button
 * that picks it. So each offer is a card of its own, they sit side by side, and
 * the row LABELS repeat inside each column rather than being frozen off to one
 * side.
 *
 * Wraps rather than scrolls. Two columns that cannot both be on screen are not
 * a comparison, and a sideways scrollbar is how the third one gets missed.
 */
function CompareColumns({
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

  /** Said once, under the columns, whenever ownership is not the same everywhere. */
  const mixedOwnership =
    rows.some((r) => r.product === "lease" || r.product === "ppa") &&
    rows.some((r) => r.product === "cash" || r.product === "loan");

  return (
    <section className="overflow-hidden rounded-xl border border-border bg-card">
      <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Compare · {rows.length} selected
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Every column priced on the same system, base price and adders.
        </p>
      </header>

      {/* auto-FILL, not auto-fit: with one programme shortlisted, auto-fit
          collapses the empty tracks and stretches that single column across the
          whole card — one $188.49 marooned in a band of white, which does not
          read as a column of a comparison. */}
      <div className="grid gap-3 p-4 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
        {rows.map((r) => (
          <CompareColumn
            key={r.id}
            row={r}
            cheapest={r.id === cheapest}
            quoted={r.id === quotedId}
            onQuote={() => onQuote(r)}
            canEdit={canEdit}
            blocked={blockedNote != null}
          />
        ))}
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
 * One offer, top to bottom, in the order a homeowner asks about it.
 *
 * The headline is whichever figure this product is actually SOLD on — a monthly
 * payment for anything financed, the contract price for cash, a rate per kWh
 * for a PPA — and it carries that line's test id, so the figure is on the
 * screen exactly once whichever shape the offer takes.
 */
function CompareColumn({
  row,
  cheapest,
  quoted,
  onQuote,
  canEdit,
  blocked,
}: {
  row: CompareRow;
  cheapest: boolean;
  quoted: boolean;
  onQuote: () => void;
  canEdit: boolean;
  /** The deal has no system size, so the money lines are held open as dashes. */
  blocked: boolean;
}) {
  const headline =
    row.monthlyCents != null
      ? { key: "monthly", value: `${money2(row.monthlyCents)}/mo`, note: "per month" }
      : row.contractPriceCents != null
        ? { key: "contract-price", value: money(row.contractPriceCents), note: "contract price" }
        : row.rateMillsPerKwh != null
          ? {
              key: "rate",
              value: `$${(row.rateMillsPerKwh / 1000).toFixed(3)}/kWh`,
              note: "escalates each year",
            }
          : {
              key: row.product === "cash" ? "contract-price" : "monthly",
              value: "—",
              note: "not priced yet",
            };

  // Everything the headline did not already say. A line every column leaves
  // blank is dropped — EXCEPT when the deal itself is what is missing, because
  // dropping the payment, the contract price and the total all at once turns a
  // comparison of what things cost into a list of dealer fees.
  const lines = LINES.filter(
    (l) => l.key !== headline.key && (l.cell(row) != null || (blocked && MONEY_LINES.has(l.key)))
  );

  return (
    <article
      data-testid="compare-col"
      data-offer-id={row.id}
      className={cn(
        "flex flex-col rounded-xl border p-3.5",
        quoted ? "border-solar bg-solar/[0.04] ring-1 ring-solar" : "border-border bg-card"
      )}
    >
      <div className="text-[11px] text-muted-foreground">{row.lenderName ?? "No lender"}</div>
      <div className="text-sm font-semibold leading-snug">{row.label}</div>
      <div className="mt-1.5 flex flex-wrap items-center gap-1">
        <span
          className={cn(
            "rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide",
            KIND_STYLE[row.product]
          )}
        >
          {PRODUCT_LABEL[row.product]}
        </span>
        {cheapest && (
          <span className="rounded border border-emerald-600/20 bg-emerald-50 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-800 dark:border-emerald-400/25 dark:bg-emerald-400/10 dark:text-emerald-300">
            Lowest total
          </span>
        )}
      </div>

      <div className="mt-3 border-t border-border/60 pt-3">
        <div
          data-testid={`compare-${headline.key}`}
          className="font-display text-2xl font-semibold tabular-nums"
        >
          {headline.value}
        </div>
        <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
          {headline.note}
        </div>
      </div>

      <dl className="mt-3 space-y-1 text-sm">
        {lines.map((line) => (
          <div key={line.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-[11px] text-muted-foreground">{line.label}</dt>
            <dd
              data-testid={`compare-${line.key}`}
              className="text-right tabular-nums"
            >
              {line.cell(row) ?? <span className="text-muted-foreground">—</span>}
            </dd>
          </div>
        ))}
      </dl>

      {/* Said on the column, not once under the table. A capped column and an
          uncapped one sit side by side here and are priced by different rules;
          a footnote below both would not say WHICH of them moved. */}
      {row.capped && row.maxFinalPpwCents != null && (
        <p
          data-testid="compare-capped"
          className={cn(
            "mt-2.5 rounded-lg border px-2 py-1.5 text-[11px]",
            row.adderOverrun
              ? "border-red-300/70 bg-red-50 text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200"
              : "border-amber-300/70 bg-amber-50 text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200"
          )}
        >
          {row.adderOverrun ? (
            <>
              The adders alone are over {row.lenderName ?? "this lender"}&rsquo;s $
              {(row.maxFinalPpwCents / 100).toFixed(2)}/W cap, so this contract cannot get under
              it. Cut the extra work or quote another lender.
            </>
          ) : (
            <>
              Held at {row.lenderName ?? "this lender"}&rsquo;s $
              {(row.maxFinalPpwCents / 100).toFixed(2)}/W cap
              {row.netPpwCents != null && <> — you keep ${(row.netPpwCents / 100).toFixed(2)}/W</>}.
            </>
          )}
        </p>
      )}

      {/* mt-auto: the columns stretch to the tallest of them, and a lease with
          three lines against a loan with five would otherwise put its button
          two inches higher — a row of buttons at four different heights is a
          harder thing to point at than a row of prices. */}
      {canEdit && (
        <div className="mt-auto pt-3">
          {quoted ? (
            <span className="inline-flex items-center gap-1 text-[11px] font-semibold text-solar">
              <Check className="size-3.5" /> Quoted
            </span>
          ) : (
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              // Several buttons reading "Quote this" are several identical
              // announcements. The visible text is kept inside the name so
              // speech control still works on what is read.
              aria-label={`Quote this: ${row.lenderName ? `${row.lenderName} ` : ""}${row.label}`}
              onClick={onQuote}
            >
              Quote this
            </Button>
          )}
        </div>
      )}
    </article>
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
  /**
   * Every way to pay, in one flat list: cash first, then each lender's
   * programmes in the order its rate sheet was entered.
   *
   * Grouped per lender it was three stacked rows, each scrolling sideways, and
   * the answer to "show me my options" was three headings and a lot of white.
   * Flat, they wrap into a grid and a rep sees all of them at once — which is
   * the only reason to put them on one screen.
   */
  const shelf = React.useMemo(() => {
    const byLender = new Map<string, OfferProduct[]>();
    for (const p of products) {
      const list = byLender.get(p.lenderId);
      if (list) list.push(p);
      else byLender.set(p.lenderId, [p]);
    }
    type ShelfCard = {
      id: string;
      title: string;
      kind: FinanceProduct;
      terms: string | null;
      lenderName: string | null;
      logoUrl: string | null;
    };
    const cards: ShelfCard[] = [
      {
        id: CASH_OFFER_ID,
        title: "Cash",
        kind: "cash",
        terms: "Paid in full. No lender, so no dealer fee.",
        lenderName: null,
        logoUrl: null,
      },
    ];
    for (const l of lenders) {
      for (const p of byLender.get(l.id) ?? []) {
        cards.push({
          id: p.id,
          title: p.label,
          kind: p.product,
          terms:
            [
              p.isActive ? null : "retired",
              lenderProductLabel(p) === p.label ? null : lenderProductLabel(p),
            ]
              .filter(Boolean)
              .join(" · ") || null,
          lenderName: l.isActive ? l.name : `${l.name} · retired`,
          logoUrl: l.logoUrl,
        });
      }
    }
    return cards;
  }, [products, lenders]);

  /** Lenders the company has set up but has entered no terms for. */
  const emptySheets = React.useMemo(
    () => lenders.filter((l) => !products.some((p) => p.lenderId === l.id)),
    [lenders, products]
  );

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

  const cardFor = (c: {
    id: string;
    title: string;
    kind: FinanceProduct;
    terms: string | null;
    lenderName: string | null;
    logoUrl: string | null;
  }) => {
    const { id, title, kind, terms } = c;
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
        lenderName={c.lenderName}
        logoUrl={c.logoUrl}
        headline={headline}
        headlineNote={note}
        creditNote={
          row?.withoutCreditsMonthlyCents != null
            ? `${money2(row.withoutCreditsMonthlyCents)}/mo without the tax credit`
            : null
        }
        // On the shelf too, not only in the comparison below: the shelf is what
        // a rep reads first, and a monthly a third of its neighbours' with no
        // explanation attached reads as a mistake in the rate sheet.
        capNote={
          row?.capped && row.maxFinalPpwCents != null
            ? row.adderOverrun
              ? `Adders exceed the $${(row.maxFinalPpwCents / 100).toFixed(2)}/W cap`
              : `Capped at $${(row.maxFinalPpwCents / 100).toFixed(2)}/W`
            : null
        }
        capBroken={row?.adderOverrun ?? false}
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

        <div className="space-y-3 p-4">
          {/* ONE GRID, NOT A ROW PER LENDER. Cash leads because it is the
              comparison every financed programme is argued against; after it
              the cards simply flow and wrap, so a company with three partners
              and eight programmes fills the screen rather than hiding six of
              them off the right-hand edge of three separate scrollers. */}
          <div className="grid gap-3 [grid-template-columns:repeat(auto-fill,minmax(15rem,1fr))]">
            {shelf.map((c) => cardFor(c))}
          </div>

          {lenders.length === 0 && (
            <p className="rounded-lg border border-amber-300/70 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">
              No lenders set up yet, so cash is the only way to quote this deal.{" "}
              <Link href="/portal/settings/solar-lenders" className="font-medium underline underline-offset-2">
                Add your lenders →
              </Link>
            </p>
          )}

          {/* A partner with no terms on file has no card in the grid, so it
              would otherwise vanish from the screen entirely — and "where is
              Amos?" is a question about a rate sheet nobody entered, not about
              this deal. */}
          {emptySheets.length > 0 && (
            <p className="text-[11px] text-muted-foreground">
              Nothing on{" "}
              {emptySheets.map((l, i) => (
                <span key={l.id}>
                  {i > 0 && (i === emptySheets.length - 1 ? " or " : ", ")}
                  <strong className="font-medium text-foreground">{l.name}</strong>
                </span>
              ))}
              &rsquo;s rate sheet yet.{" "}
              <Link
                href="/portal/settings/solar-lenders"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Add the terms
              </Link>{" "}
              and the programmes appear here.
            </p>
          )}
        </div>
      </section>

      {selected.length > 0 ? (
        <CompareColumns
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
