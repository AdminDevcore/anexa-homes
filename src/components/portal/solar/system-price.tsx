"use client";

import * as React from "react";
import { Minus, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { grossPpwFromNet, pricePurchase } from "@/lib/solar-money";

/**
 * What this company charges for THIS system, and the one control that moves it.
 *
 * The financing step could price a deal four ways and could not change the
 * price of the thing being financed. There was a "Gross $/W" box, but it sat
 * below a shelf of lender cards and a comparison table — a rep scrolled past
 * every number derived from the price before reaching the price — and on a
 * company with a net target set, typing in it moved the contract total while
 * the cards above carried on quoting the company default. Two prices on one
 * screen, and the customer-facing one was the one further from the rep's hand.
 *
 * So the price comes first, it is one number, and everything below is that
 * number multiplied by something.
 *
 * THE BASE IS OURS, NOT THE CUSTOMER'S. It is what Anexa keeps per watt before
 * a lender takes its cut, which is why cash pays exactly the base and a 28%
 * programme costs the homeowner $3.99 for the same roof that Climate First
 * sells at $3.50. Quoting one sticker across every lender would either give the
 * bank's fee away out of margin or charge a cash buyer for a fee no bank
 * levied. See `stickerCents` in solar-compare.ts — every column grosses this up
 * by its OWN fee.
 *
 * Typed two ways because a rep is measured in dollars per watt and a homeowner
 * hears a total. They are the same number; whichever box is typed in, the other
 * follows.
 *
 * The ladder on the right is therefore ALL PRE-FEE: base, plus adders, equals
 * GROSS — what Anexa keeps. The customer's final price lives in the footer,
 * where the quoted programme's fee is named next to it.
 */
export function SystemPriceCard({
  systemSizeKwDc,
  basePpwCents,
  defaultPpwCents,
  minPpwCents,
  maxPpwCents,
  adderTotalCents,
  quotedFeePct,
  quotedLabel,
  canEdit,
  onChange,
}: {
  systemSizeKwDc: number;
  /** The deal's base price per watt, cents. Null while the box is empty. */
  basePpwCents: number | null;
  /** The company's figure, for the reset link and the "you are off default" note. */
  defaultPpwCents: number | null;
  minPpwCents: number;
  maxPpwCents: number;
  adderTotalCents: number;
  /** The dealer fee on the programme this deal is quoted on. Null on cash. */
  quotedFeePct: number | null;
  quotedLabel: string | null;
  canEdit: boolean;
  onChange: (cents: number | null) => void;
}) {
  const watts = Math.round(systemSizeKwDc * 1000);

  const fmtPpw = (c: number | null) => (c == null ? "" : (c / 100).toFixed(2));
  const fmtTotal = (c: number | null) =>
    c == null || watts === 0 ? "" : Math.round((c * watts) / 100).toString();

  const [text, setText] = React.useState(() => ({
    ppw: fmtPpw(basePpwCents),
    total: fmtTotal(basePpwCents),
  }));

  /**
   * Re-seed the boxes when the price moves from somewhere ELSE — the reset
   * link, a save that came back with a different figure, a roof redrawn in
   * another tab. Guarded on both the price and the array, because the total is
   * a function of the two and a re-seed on every render would fight the rep's
   * cursor mid-keystroke.
   */
  const last = React.useRef({ cents: basePpwCents, watts });
  React.useEffect(() => {
    if (last.current.cents === basePpwCents && last.current.watts === watts) return;
    last.current = { cents: basePpwCents, watts };
    setText({ ppw: fmtPpw(basePpwCents), total: fmtTotal(basePpwCents) });
    // fmtPpw/fmtTotal are pure over the two values already in the dep list.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [basePpwCents, watts]);

  /** A blank box is "no price", which is different from a price of zero. */
  const parse = (s: string): number | null => {
    if (s.trim() === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  };

  const push = (cents: number | null) => {
    last.current = { cents, watts };
    onChange(cents);
  };

  const typePpw = (v: string) => {
    const n = parse(v);
    const cents = n == null ? null : Math.round(n * 100);
    setText({ ppw: v, total: cents == null || watts === 0 ? "" : Math.round((cents * watts) / 100).toString() });
    push(cents);
  };

  const typeTotal = (v: string) => {
    const n = parse(v);
    const cents = n == null || watts === 0 ? null : Math.round((n * 100) / watts);
    setText({ ppw: cents == null ? "" : (cents / 100).toFixed(2), total: v });
    push(cents);
  };

  /** ±5¢ a watt — the size of a real concession, not a rounding nudge. */
  const step = (delta: number) => {
    const from = basePpwCents ?? defaultPpwCents ?? 0;
    const next = Math.max(0, from + delta);
    setText({ ppw: (next / 100).toFixed(2), total: watts === 0 ? "" : Math.round((next * watts) / 100).toString() });
    push(next);
  };

  const baseTotalCents = basePpwCents == null || watts === 0 ? null : basePpwCents * watts;
  const grossCents = baseTotalCents == null ? null : baseTotalCents + adderTotalCents;
  const adderPpw = watts > 0 ? adderTotalCents / watts : 0;
  const grossPpw = grossCents != null && watts > 0 ? grossCents / watts : null;

  /**
   * What the homeowner actually signs on the programme this deal quotes.
   *
   * Priced through `pricePurchase` rather than by hand, because the adders have
   * to gross up by the fee too — the lender takes its percentage of the re-roof
   * as well as of the array. Adding them on at face value here was quoting a
   * customer price the company could not actually net its own catalogue price
   * out of.
   */
  const customerPpw =
    basePpwCents != null && quotedFeePct != null && quotedFeePct > 0
      ? grossPpwFromNet(basePpwCents, quotedFeePct)
      : null;
  const customerContract =
    customerPpw != null && watts > 0
      ? pricePurchase({
          product: "loan",
          systemSizeKwDc,
          stickerPpwCents: customerPpw,
          dealerFeePct: quotedFeePct ?? 0,
          adderTotalCents,
        }).contractPriceCents
      : null;

  const offDefault = defaultPpwCents != null && basePpwCents != null && basePpwCents !== defaultPpwCents;
  const outOfBand =
    basePpwCents != null && (basePpwCents < minPpwCents || basePpwCents > maxPpwCents);

  return (
    <section
      aria-labelledby="system-price-heading"
      className="overflow-hidden rounded-xl border border-border bg-card"
    >
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-2.5">
        <h3
          id="system-price-heading"
          className="text-xs font-semibold uppercase tracking-wide text-muted-foreground"
        >
          System price
        </h3>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          {defaultPpwCents != null && (
            <span className="tabular-nums">
              Company default ${(defaultPpwCents / 100).toFixed(2)}/W
            </span>
          )}
          {canEdit && offDefault && (
            <Button
              variant="ghost"
              size="xs"
              onClick={() => {
                setText({ ppw: fmtPpw(defaultPpwCents), total: watts === 0 ? "" : Math.round((defaultPpwCents! * watts) / 100).toString() });
                push(defaultPpwCents);
              }}
            >
              <RotateCcw className="size-3" /> Reset
            </Button>
          )}
        </div>
      </header>

      <div className="grid gap-5 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {/* The two inputs. Same number, said the two ways it gets said out
            loud: a rep is measured per watt, a homeowner hears a total. */}
        <div className="flex flex-wrap items-start gap-4">
          <div className="space-y-1.5">
            <label
              htmlFor="base-ppw"
              className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Base $/W
            </label>
            <div className="flex items-stretch">
              <button
                type="button"
                aria-label="Lower the price by 5 cents a watt"
                disabled={!canEdit}
                onClick={() => step(-5)}
                className="flex w-9 items-center justify-center rounded-l-lg border border-r-0 border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                <Minus className="size-3.5" />
              </button>
              <div className="relative">
                <span
                  aria-hidden
                  className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-lg text-muted-foreground"
                >
                  $
                </span>
                <input
                  id="base-ppw"
                  type="number"
                  step="0.01"
                  inputMode="decimal"
                  disabled={!canEdit}
                  value={text.ppw}
                  onChange={(e) => typePpw(e.target.value)}
                  className="h-12 w-28 border-y border-input bg-transparent pl-7 pr-2 text-left font-display text-2xl font-semibold tabular-nums focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                />
              </div>
              <button
                type="button"
                aria-label="Raise the price by 5 cents a watt"
                disabled={!canEdit}
                onClick={() => step(5)}
                className="flex w-9 items-center justify-center rounded-r-lg border border-l-0 border-input text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:z-10 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50"
              >
                <Plus className="size-3.5" />
              </button>
            </div>
            <p className="text-[11px] text-muted-foreground">per installed watt</p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="base-total"
              className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
            >
              Base total
            </label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 font-display text-lg text-muted-foreground"
              >
                $
              </span>
              <input
                id="base-total"
                type="number"
                step="1"
                inputMode="numeric"
                disabled={!canEdit || watts === 0}
                value={text.total}
                onChange={(e) => typeTotal(e.target.value)}
                className="h-12 w-40 rounded-lg border border-input bg-transparent pl-7 pr-3 font-display text-2xl font-semibold tabular-nums focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-60 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
              />
            </div>
            <p className="text-[11px] text-muted-foreground">
              {watts === 0
                ? "Needs an array to price"
                : `${systemSizeKwDc.toFixed(2)} kW · before adders`}
            </p>
          </div>
        </div>

        {/* Base → adders → gross. The last rung is what Anexa keeps on this job,
            and the one that differs from the base rate on every job carrying
            extra work. The dealer fee goes on top of it, in the footer. */}
        <dl className="self-center rounded-lg bg-muted/50 p-3 text-sm">
          <Rung label="Base" ppw={basePpwCents} total={baseTotalCents} />
          <Rung label="Adders" ppw={watts > 0 ? adderPpw : null} total={adderTotalCents} muted />
          <Rung
            label="Gross"
            ppw={grossPpw}
            total={grossCents}
            strong
            ppwTestId="gross-ppw"
            totalTestId="gross-total"
          />
        </dl>
      </div>

      <footer className="space-y-2 border-t border-border/70 bg-muted/20 px-4 py-2.5">
        {outOfBand && (
          <p className="text-[11px] text-amber-700 dark:text-amber-500">
            Outside the company&rsquo;s ${(minPpwCents / 100).toFixed(2)}–$
            {(maxPpwCents / 100).toFixed(2)}/W band. It will still save — this is a guard rail,
            not a lock.
          </p>
        )}
        {customerPpw != null && customerContract != null ? (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{quotedLabel}</span>{" "}
            takes a {quotedFeePct}% dealer fee on the whole job, adders included, so the
            customer&rsquo;s final price is{" "}
            <span
              data-testid="customer-final"
              className="font-medium tabular-nums text-foreground"
            >
              ${(customerPpw / 100).toFixed(2)}/W · ${Math.round(customerContract / 100).toLocaleString()}
            </span>
            . Cash pays the gross.
          </p>
        ) : (
          <p className="text-[11px] text-muted-foreground">
            This is what Anexa keeps before a lender&rsquo;s cut. Cash pays it as it stands;
            every financed programme below grosses it up by its own dealer fee.
          </p>
        )}
      </footer>
    </section>
  );
}

/** One rung of the ladder: a rate and the money it comes to. */
function Rung({
  label,
  ppw,
  total,
  muted,
  strong,
  ppwTestId,
  totalTestId,
}: {
  label: string;
  /** Cents per watt. Null where there is no array to divide by. */
  ppw: number | null;
  total: number | null;
  muted?: boolean;
  strong?: boolean;
  /** Split across the two figures on purpose: a test that reads one element
   *  holding "$3.39/W · $33,850" and strips the punctuation gets 3.3933850. */
  ppwTestId?: string;
  totalTestId?: string;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-4 py-1",
        strong && "mt-1 border-t border-border pt-2"
      )}
    >
      <dt className={cn("text-xs", strong ? "font-semibold" : "text-muted-foreground")}>{label}</dt>
      <dd
        className={cn(
          "flex items-baseline gap-2 tabular-nums",
          strong ? "font-semibold" : muted ? "text-muted-foreground" : ""
        )}
      >
        {/* Rounded to the nearest cent BEFORE the decimal is placed. A rate of
            338.5 cents a watt is a real outcome — $3.00 base with $3,850 of
            adders on 10 kW — and `(338.5 / 100).toFixed(2)` answers "3.38",
            because 3.385 is not representable and lands a hair below. The rate
            a rep is measured on should not be a cent light because of binary
            floating point. */}
        <span data-testid={ppwTestId} className="text-xs opacity-70">
          {ppw == null ? "—" : `$${(Math.round(ppw) / 100).toFixed(2)}/W`}
        </span>
        <span data-testid={totalTestId} className={strong ? "font-display text-base" : "text-sm"}>
          {total == null ? "—" : `$${Math.round(total / 100).toLocaleString()}`}
        </span>
      </dd>
    </div>
  );
}
