"use client";

import * as React from "react";
import { Check, Minus, Pencil, Plus, RotateCcw } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import {
  basePpwFromSticker,
  capStickerToFinalPpw,
  capStickerToFinalUnit,
  grossPpwFromNet,
  pricePurchase,
  priceStoragePurchase,
} from "@/lib/solar-money";

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
 * The ladder on the right runs from the base to what the household signs:
 * base, plus adders, plus the battery, equals GROSS — what Anexa keeps — and
 * then the lender's cut and the customer's price, the two rungs that only
 * exist where somebody else is taking a share. The footer names the rule that
 * produced the last one.
 *
 * THE HEADLINE IS THE GROSS, NOT THE BASE — 2026-09-08.
 *
 * It led with the base for as long as this card existed, on the reasoning that
 * the base is the one figure a rep can move. But the card is called SYSTEM
 * PRICE, and the price of the system is not the base: on a job carrying a
 * $120,000 battery the two big numbers read "$1.93/W · $24,627" over a ladder
 * ending in $144,627, and the figure a rep quotes for the system was the small
 * one in the corner. Cash pays the gross. Every column on the shelf below is
 * the gross with a fee on it. So the gross is what the card says first.
 *
 * The base did not go anywhere and is still the only thing on this card anybody
 * can type: it is the line under the headline, it opens the same editor, and it
 * is the first rung of the ladder that arrives at the figure above it.
 */
export function SystemPriceCard({
  systemSizeKwDc,
  basePpwCents,
  defaultPpwCents,
  adderTotalCents,
  onTopAdderTotalCents = 0,
  batteryPriceCents = 0,
  batteryLabel = null,
  batteryQty = 0,
  quotedFeePct,
  quotedMaxFinalPpwCents,
  quotedFinalPpwMode,
  quotedMinBasePpwCents,
  quotedLabel,
  canEdit,
  onChange,
}: {
  systemSizeKwDc: number;
  /** The deal's base price per watt, cents. Null while the box is empty. */
  basePpwCents: number | null;
  /** The company's figure, for the reset link and the "you are off default" note. */
  defaultPpwCents: number | null;
  /** The adders INSIDE the partner's price. See `PurchaseInput`. */
  adderTotalCents: number;
  /**
   * The adders financed ON TOP of it — a roof on a flat-rate partner.
   *
   * Kept apart from the figure above because the two move different numbers:
   * the ordinary adders come out of a ceiling, and these ride above it. A card
   * that summed them into the cap solve would print a customer price the
   * financing step below is not going to quote.
   *
   * OPTIONAL, defaulting to none, because the screen that supplies it is still
   * being built. Required, it shipped a card whose own caller did not compile
   * and turned main red for everybody; a caller that knows about on-top work
   * says so, and one that does not has none.
   */
  onTopAdderTotalCents?: number;
  /**
   * WHAT THE STORAGE ON THIS JOB ADDS, at its catalogue price.
   *
   * A rung of its own rather than a share of the adders, because it answers a
   * question a rep is asked out loud — "what am I charging them for the
   * battery?" — and because it is priced by a different rule: a rate per watt
   * is a price for an array, so the battery rides on top of it exactly as a
   * roof does on a flat-rate partner. Zero on a deal without one.
   */
  batteryPriceCents?: number;
  /** What it is, and how many, for the rung's own label. */
  batteryLabel?: string | null;
  batteryQty?: number;
  /** The dealer fee on the programme this deal is quoted on. Null on cash. */
  quotedFeePct: number | null;
  /**
   * That programme's publisher's ceiling on the final price per watt, cents.
   * Read here so this footer cannot claim a customer price the financing step
   * below is going to cap — one screen quoting $142,824 while the next quotes
   * $48,400 for the same deal is worse than either figure alone.
   */
  quotedMaxFinalPpwCents: number | null;
  /**
   * Whether that figure is a ceiling or this partner's flat price.
   *
   * On `flat` the base box below is no longer the price of anything a customer
   * sees — the partner's rate is — so the card says so rather than leaving a
   * rep typing into a number with no effect on the quote.
   */
  quotedFinalPpwMode: "cap" | "flat";
  /**
   * That publisher's floor under what the company keeps per watt, cents. Null
   * on cash and on any lender that sets none.
   */
  quotedMinBasePpwCents: number | null;
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

  /**
   * Whether the price is open for editing.
   *
   * Closed is the resting state, INCLUDING after a save: a rep opens the price,
   * moves it, and the screen goes back to reading like a quote rather than a
   * form. `canEdit` false never opens at all.
   */
  const [editing, setEditing] = React.useState(false);
  const ppwRef = React.useRef<HTMLInputElement>(null);
  const totalRef = React.useRef<HTMLInputElement>(null);

  /** Open on the box the rep actually clicked, with the cursor already in it. */
  const open = (which: "ppw" | "total") => {
    if (!canEdit) return;
    setEditing(true);
    // After the inputs exist. Selecting rather than just focusing, so the first
    // keystroke replaces the price instead of appending a digit to it.
    requestAnimationFrame(() => {
      const el = which === "ppw" ? ppwRef.current : totalRef.current;
      el?.focus();
      el?.select();
    });
  };

  const baseTotalCents = basePpwCents == null || watts === 0 ? null : basePpwCents * watts;
  // Both halves. The ladder on the right is what the COMPANY keeps, and a roof
  // financed on top is kept whole exactly like an adder inside the fee — what
  // differs is which side of the partner's ceiling it is paid out of, not
  // whether it is paid.
  const allAdderCents = adderTotalCents + onTopAdderTotalCents;
  // The battery is kept whole here for the same reason a roof financed on top
  // is: it is money the company keeps, and what differs is only which side of
  // the partner's ceiling it is paid out of.
  const grossCents =
    baseTotalCents == null ? null : baseTotalCents + allAdderCents + batteryPriceCents;
  const adderPpw = watts > 0 ? allAdderCents / watts : 0;
  const grossPpw = grossCents != null && watts > 0 ? grossCents / watts : null;

  /**
   * What the headline total is FOR, named by what is actually in it.
   *
   * "12.76 kW · before adders" belongs to the base and would be a lie over the
   * gross; "12.76 kW" alone leaves a rep guessing which of the card's four
   * figures this one is. So the note lists whatever this job put on top, and
   * says so plainly on the deals — most of them — that put nothing.
   */
  const grossNote = (() => {
    if (watts === 0) return "Needs an array to price";
    const inside = [
      allAdderCents > 0 ? "adders" : null,
      batteryPriceCents > 0 ? "battery" : null,
    ].filter(Boolean);
    return `${systemSizeKwDc.toFixed(2)} kW · ${
      inside.length === 0 ? "nothing on top of the base" : `${inside.join(" and ")} included`
    }`;
  })();

  /**
   * What the homeowner actually signs on the programme this deal quotes.
   *
   * Priced through `pricePurchase` rather than by hand, because the adders have
   * to gross up by the fee too — the lender takes its percentage of the re-roof
   * as well as of the array. Adding them on at face value here was quoting a
   * customer price the company could not actually net its own catalogue price
   * out of.
   */
  const uncappedCustomerPpw =
    basePpwCents != null && quotedFeePct != null && quotedFeePct > 0
      ? grossPpwFromNet(basePpwCents, quotedFeePct)
      : null;
  /**
   * A FLAT partner does not need a base to have a price.
   *
   * Every figure below is solved out of the customer's number, and on a flat
   * lender that number is published rather than derived — so the footer can
   * quote the deal before anybody has typed a base, which is exactly the state
   * a rep is in when they pick "Amos 30 Y" and expect $5.50/W to appear.
   */
  const flatSeedPpw =
    quotedFinalPpwMode === "flat" && quotedMaxFinalPpwCents != null
      ? (uncappedCustomerPpw ?? quotedMaxFinalPpwCents)
      : uncappedCustomerPpw;
  const customerCap =
    flatSeedPpw == null
      ? null
      : capStickerToFinalPpw({
          stickerPpwCents: flatSeedPpw,
          maxFinalPpwCents: quotedMaxFinalPpwCents,
          mode: quotedFinalPpwMode,
          systemSizeKwDc,
          dealerFeePct: quotedFeePct ?? 0,
          // Only the work the partner's figure is a price FOR.
          adderTotalCents,
        });
  const customerPpw = customerCap?.stickerPpwCents ?? flatSeedPpw;
  const customerPriced =
    customerPpw != null && watts > 0
      ? pricePurchase({
          product: "loan",
          systemSizeKwDc,
          stickerPpwCents: customerPpw,
          dealerFeePct: quotedFeePct ?? 0,
          adderTotalCents,
          onTopAdderTotalCents,
          batteryPriceCents,
        })
      : null;
  const customerContract = customerPriced?.contractPriceCents ?? null;
  /**
   * The rate the FOOTER quotes, which is the contract divided by the watts —
   * not `customerPpw`.
   *
   * Those are the same number only on a job with no extra work. `customerPpw`
   * is the SYSTEM's sticker; the adders gross up and sit on top of it, so on a
   * 24.6 kW deal carrying $2,000 of work the footer was printing "$5.26/W ·
   * $135,321" — two figures that do not divide into each other, side by side,
   * under the words "the customer's final price".
   */
  const customerFinalPpw = customerPriced?.finalPpwCents ?? null;

  /**
   * THE LENDER'S CUT, TAKEN AS THE DIFFERENCE, not recomputed as a percentage.
   *
   * The ladder is read as arithmetic — a rep runs a finger down the column and
   * a homeowner across the table adds it up — so gross plus fee has to equal
   * final EXACTLY, on the two figures actually printed. `dealerFeeCents` off
   * the breakdown is the fee on the SOLVED sticker, which is a different number
   * from the gross this card prints the moment a partner rule has moved the
   * price: near enough to look right, far enough for the column not to add up,
   * which is the one thing a price table may never do.
   *
   * WITHHELD WHERE A PARTNER RULE BOUND THE PRICE — `customerCap.capped`.
   *
   * Under a ceiling, and under a flat rate always, the customer's price is not
   * this company's gross with a percentage on it: the partner pinned the
   * contract and the sticker was solved backwards out of it, so the gap between
   * the gross above and the price below is the fee PLUS however far the rule
   * moved the base a rep typed. Amos at $5.50/W leaves $1.92 a watt whatever
   * was typed, so on a base of $2.87 the difference is a $27,670 "fee" against
   * a real one of $42,874. Neither figure is wrong on its own and the
   * subtraction between them is meaningless, so the row stands down and the
   * footer names the rule instead. Also null on cash and on a fee-free
   * programme, which have no cut to show.
   */
  const lenderFeeCents =
    grossCents == null ||
    customerContract == null ||
    customerCap?.capped ||
    customerContract <= grossCents
      ? null
      : customerContract - grossCents;
  const lenderFeePpw = lenderFeeCents != null && watts > 0 ? lenderFeeCents / watts : null;

  /**
   * What the last rung says about itself: the programme it is quoted on, or —
   * where the partner's own rule set the price rather than the base above did —
   * that rule, because that is the answer to the question the row provokes.
   * "Customer pays $65,960" under "Gross $38,290" with no fee between them is a
   * $27,670 hole a rep will otherwise fill in with a guess.
   */
  const finalNote =
    customerCap?.capped && quotedMaxFinalPpwCents != null
      ? `${quotedFinalPpwMode === "flat" ? "flat" : "held at"} $${(
          quotedMaxFinalPpwCents / 100
        ).toFixed(2)}/W`
      : null;

  const offDefault = defaultPpwCents != null && basePpwCents != null && basePpwCents !== defaultPpwCents;

  /**
   * What this deal actually leaves the company, after the fee AND after the cap.
   *
   * Not `basePpwCents`. On an uncapped lender they are the same figure and this
   * says nothing new; on a capped one the sticker was solved back down, so the
   * base typed into the box above is not the base anybody is getting — Amos at
   * $5.50/W and 65% leaves $1.93 however confidently $3.00 was typed. A floor
   * measured against the box would pass a deal that netted a third of it, which
   * is the entire reason this line exists rather than a comparison inline.
   */
  const keptBasePpwCents =
    customerPpw == null ? basePpwCents : basePpwFromSticker(customerPpw, quotedFeePct ?? 0);
  const belowFloor =
    quotedMinBasePpwCents != null &&
    quotedMinBasePpwCents > 0 &&
    keptBasePpwCents != null &&
    keptBasePpwCents < quotedMinBasePpwCents;

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
        {/* THE PRICE IS A FIGURE UNTIL SOMEBODY ASKS TO CHANGE IT.

            Number boxes with plus and minus buttons on them announce, to
            whoever is looking at the screen, that the price of this system is
            a thing anyone present can move. A rep turns this laptop around. So
            the price reads as a price, and the controls that move it appear
            when the rep clicks it — the same edit, one click further from a
            homeowner's eye.

            The price of the system leads, said the two ways it gets said out
            loud: a rep is measured per watt, a homeowner hears a total. The
            base — the company's side of it, and the only thing here anybody
            types — is the line underneath. */}
        <div
          className="space-y-3"
          onBlur={(e) => {
            // Collapse only when focus has actually LEFT the price block.
            // Tabbing from the $/W box to the total is still editing, and a
            // bare onBlur would slam it shut between the two.
            if (e.currentTarget.contains(e.relatedTarget as Node | null)) return;
            // AFTER the click that caused the blur, not during it. Collapsing
            // swaps two number boxes and a Done button for two short figures,
            // which re-flows this row — and a rep who left the price by
            // clicking a button underneath it would have that button move
            // between mousedown and mouseup, so the browser fires the click on
            // their common ancestor instead and the press does nothing. The
            // price would silently eat the first click on everything below it.
            setTimeout(() => setEditing(false), 0);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape" && editing) {
              e.stopPropagation();
              setEditing(false);
            }
          }}
        >
          {/* THE PRICE OF THE SYSTEM, which is the gross — what this company
              charges for this job, adders and battery included, before any
              lender takes a cut of it. Cash pays exactly this.

              Not editable, and not for want of a control: it is base × watts
              plus the work on the deal, so the way to move it is to move one of
              those. The base is directly underneath. */}
          <div className="flex flex-wrap items-start gap-x-8 gap-y-3">
            <PriceFigure
              label="Gross $/W"
              value={grossPpw == null ? "—" : `$${(Math.round(grossPpw) / 100).toFixed(2)}`}
              note="per installed watt"
              canEdit={false}
            />
            <PriceFigure
              label="Gross total"
              value={grossCents == null ? "—" : `$${Math.round(grossCents / 100).toLocaleString()}`}
              note={grossNote}
              canEdit={false}
            />
          </div>

          {editing ? (
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
                      ref={ppwRef}
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
                    ref={totalRef}
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

              <Button
                type="button"
                variant="ghost"
                size="sm"
                className="mt-5"
                onClick={() => setEditing(false)}
              >
                <Check className="size-3.5" /> Done
              </Button>
            </div>
          ) : (
            /* THE ONE FIGURE ON THIS CARD ANYBODY CAN TYPE, said the way a rep
               says it — a rate and the money it comes to — and small, because
               what Anexa keeps per watt is not the number a homeowner across
               the table is meant to read off the screen. It opens the same
               editor the two big figures used to. */
            <BaseLine
              basePpwCents={basePpwCents}
              baseTotalCents={baseTotalCents}
              canEdit={canEdit}
              onOpen={() => open("ppw")}
            />
          )}
        </div>

        {/* THE LADDER RUNS ALL THE WAY DOWN NOW — 2026-09-09.

            Base → adders → battery → GROSS is what Anexa keeps, and for as
            long as this card existed that is where the column stopped. The
            figure a rep says out loud to the homeowner — what the household
            actually signs — existed only inside a sentence in the footer, so
            the one number on the screen with a customer's name on it was the
            one number not printed as a number.

            So the ladder carries on past the gross: the lender's cut, then the
            price. Two rungs, one border heavier than the rest, and the last
            line is the biggest thing on this side of the card.

            A TABLE, not a stack of flex rows. Two money columns that mean
            different things — a rate and an amount — do not read as columns
            until they line up, and rows sized to their own contents put
            $120,000 under $0.00/W. The browser aligns a table's columns for
            free, the header says once what each column is so no cell has to
            repeat "/W", and a screen reader gets a real row and column header
            instead of a run-on definition list. */}
        <div className="self-center rounded-lg bg-muted/50 px-4 py-3">
          <table className="w-full text-sm">
            <caption className="sr-only">
              What this system costs, from the base rate to what the customer signs
            </caption>
            <thead>
              <tr className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                <th scope="col" className="pb-2 text-left font-medium">
                  <span className="sr-only">Line</span>
                </th>
                <th scope="col" className="pb-2 pl-6 text-right font-medium">
                  $/W
                </th>
                <th scope="col" className="pb-2 pl-8 text-right font-medium">
                  Amount
                </th>
              </tr>
            </thead>
            <tbody>
              <Rung label="Base" ppw={basePpwCents} total={baseTotalCents} />
              <Rung label="Adders" ppw={watts > 0 ? adderPpw : null} total={allAdderCents} muted />
              {/* Only where there is one. A "$0" battery rung on the four deals
                  in five that have no storage is a row a rep has to read to
                  learn nothing. */}
              {batteryPriceCents > 0 && (
                <Rung
                  label={batteryQty > 1 ? `Battery × ${batteryQty}` : "Battery"}
                  ppw={null}
                  total={batteryPriceCents}
                  muted
                />
              )}
              <Rung
                label="Gross"
                note="what we keep"
                ppw={grossPpw}
                total={grossCents}
                strong
                ppwTestId="gross-ppw"
                totalTestId="gross-total"
              />
              {/* The two rungs below the gross exist only where somebody else
                  is taking a cut. Cash pays the gross, so on cash the ladder
                  ends where the money does. */}
              {lenderFeeCents != null && (
                <Rung
                  label={quotedFeePct ? `Dealer fee · ${quotedFeePct}%` : "Dealer fee"}
                  ppw={lenderFeePpw}
                  total={lenderFeeCents}
                  muted
                />
              )}
              {customerContract != null && (
                <Rung
                  label="Customer pays"
                  note={finalNote ?? undefined}
                  ppw={customerFinalPpw ?? customerPpw}
                  total={customerContract}
                  final
                  ppwTestId="final-ppw"
                  totalTestId="final-total"
                />
              )}
            </tbody>
          </table>
        </div>
      </div>

      <footer className="space-y-2 border-t border-border/70 bg-muted/20 px-4 py-2.5">
        {/* THE COMPANY-WIDE $/W BAND USED TO WARN HERE.
            Gone 2026-09-02: what a deal may price at belongs to the loan
            product, so the only margin rule left is the partner's own floor
            below — which is the one readiness and the re-price also ask. */}
        {belowFloor && (
          <p className="text-[11px] font-medium text-destructive">
            This leaves ${((keptBasePpwCents ?? 0) / 100).toFixed(2)}/W before the lender&rsquo;s
            cut, under {quotedLabel ? "this lender" : "the lender"}&rsquo;s $
            {((quotedMinBasePpwCents ?? 0) / 100).toFixed(2)}/W minimum.
            {customerCap?.capped
              ? " Its cap is holding the customer price down, so the extra work is coming out of your side."
              : " The proposal will not generate until the price comes up."}
          </p>
        )}
        {customerPpw != null && customerContract != null ? (
          <p className="text-[11px] text-muted-foreground">
            <span className="font-medium text-foreground">{quotedLabel}</span>{" "}
            {quotedFinalPpwMode === "flat" && quotedMaxFinalPpwCents != null ? (
              <>
                sells at a flat ${(quotedMaxFinalPpwCents / 100).toFixed(2)}/W, fee and adders
                included{onTopAdderTotalCents > 0 ? " apart from the work financed on top" : ""}{" "}
                — the base above only changes what you keep, so the customer&rsquo;s final
                price is{" "}
              </>
            ) : customerCap?.capped && quotedMaxFinalPpwCents != null ? (
              <>
                never charges more than ${(quotedMaxFinalPpwCents / 100).toFixed(2)}/W, fee and
                adders included
                {onTopAdderTotalCents > 0 ? " apart from the work financed on top" : ""}, so the
                customer&rsquo;s final price is held at{" "}
              </>
            ) : (
              <>
                takes a {quotedFeePct}% dealer fee on the whole job, adders included, so the
                customer&rsquo;s final price is{" "}
              </>
            )}
            <span
              data-testid="customer-final"
              className="font-medium tabular-nums text-foreground"
            >
              ${((customerFinalPpw ?? customerPpw) / 100).toFixed(2)}/W · $
              {Math.round(customerContract / 100).toLocaleString()}
            </span>
            .{" "}
            {/* The one figure on this card that is ABOVE the partner's rate.
                Without saying so, a rep reads "$5.50/W flat" beside "$6.20/W"
                and has to guess which of the two the customer signs. */}
            {onTopAdderTotalCents > 0 && (
              <>
                That includes ${Math.round(onTopAdderTotalCents / 100).toLocaleString()} of work
                financed on top of the rate.{" "}
              </>
            )}
            {/* Said for the same reason the roof is: this is the other figure
                on the card that sits ABOVE the partner's published rate, and a
                rep reading "$5.50/W flat" beside "$9.50/W" is entitled to know
                which of the two the household signs, and why. */}
            {batteryPriceCents > 0 && (
              <>
                It also includes ${Math.round(batteryPriceCents / 100).toLocaleString()} for the
                {batteryLabel ? ` ${batteryLabel}` : " battery"}
                {batteryQty > 1 ? ` × ${batteryQty}` : ""}, priced from the catalogue and added on
                top of the rate.{" "}
              </>
            )}
            Cash pays the gross.
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

/**
 * A price, shown as a price.
 *
 * A button rather than a div with a click handler: this is the only way into
 * editing the number, so it has to be reachable from a keyboard and announce
 * itself as something that does something. Read-only users get the same figure
 * with nothing to press.
 */
function PriceFigure({
  label,
  value,
  note,
  canEdit,
  editLabel,
  onOpen,
}: {
  label: string;
  value: string;
  note: string;
  canEdit: boolean;
  /**
   * What a screen reader hears. The visible text is a bare number.
   *
   * Optional along with `onOpen`, because since the gross became the headline
   * this component draws DERIVED figures too — base × watts plus the work on
   * the deal is not a box, and there is nothing for a pencil to open.
   */
  editLabel?: string;
  onOpen?: () => void;
}) {
  return (
    <div className="space-y-1.5">
      <span className="block text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {label}
      </span>
      {canEdit && onOpen ? (
        <button
          type="button"
          aria-label={editLabel}
          onClick={onOpen}
          className="group -mx-2 flex h-12 items-center gap-2 rounded-lg px-2 text-left transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
        >
          <span className="font-display text-2xl font-semibold tabular-nums">{value}</span>
          <Pencil className="size-3.5 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
        </button>
      ) : (
        <span className="flex h-12 items-center font-display text-2xl font-semibold tabular-nums">
          {value}
        </span>
      )}
      <p className="text-[11px] text-muted-foreground">{note}</p>
    </div>
  );
}

/**
 * The base, under the headline it is the first rung of.
 *
 * A BUTTON, and the same one the two big figures used to be: this is still the
 * only way into editing the price, so it has to be reachable from a keyboard
 * and announce itself as something that does something. Its accessible name is
 * unchanged from when it was the headline — a rep and a spec both still ask for
 * "the base price per watt", and the figure moving down the card did not change
 * what it is called. Read-only users get the same line with nothing to press.
 */
function BaseLine({
  basePpwCents,
  baseTotalCents,
  canEdit,
  onOpen,
}: {
  basePpwCents: number | null;
  baseTotalCents: number | null;
  canEdit: boolean;
  onOpen: () => void;
}) {
  const figure = (
    <>
      <span className="text-muted-foreground">Base</span>{" "}
      <span className="font-medium tabular-nums text-foreground">
        {basePpwCents == null ? "—" : `$${(basePpwCents / 100).toFixed(2)}/W`}
        {baseTotalCents == null
          ? ""
          : ` · $${Math.round(baseTotalCents / 100).toLocaleString()}`}
      </span>
    </>
  );

  if (!canEdit) return <p className="text-xs">{figure}</p>;

  return (
    <button
      type="button"
      aria-label={`Edit the base price per watt${
        basePpwCents == null ? "" : `, currently $${(basePpwCents / 100).toFixed(2)} a watt`
      }`}
      onClick={onOpen}
      className="group -mx-2 inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-xs transition-colors hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
    >
      {figure}
      <Pencil className="size-3 shrink-0 text-muted-foreground opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" />
    </button>
  );
}

/**
 * One rung of the ladder: a rate, and the money it comes to.
 *
 * A ROW OF A TABLE, so that every rung's rate sits under every other rung's
 * rate however wide the amount beside it is. The two columns are set apart by
 * padding rather than by a rule — a line between them would read as a divider
 * between two tables, and they are one sentence: this many dollars a watt,
 * which is this much money.
 */
function Rung({
  label,
  note,
  ppw,
  total,
  muted,
  strong,
  final: isFinal,
  ppwTestId,
  totalTestId,
}: {
  label: string;
  /**
   * What the rung IS, under its name — "what we keep" under the gross, the
   * partner's rule under the customer's price. The two rungs anybody argues
   * about are the two that need saying whose money they are, and a row that
   * says it in its own label ("Gross (what we keep)") is a label that no
   * longer lines up with "Base" above it.
   */
  note?: string;
  /** Cents per watt. Null where there is no array to divide by. */
  ppw: number | null;
  total: number | null;
  muted?: boolean;
  /** The subtotal: what the company keeps. Ruled off above, set in bold. */
  strong?: boolean;
  /** The last line — what the household signs. The biggest figure on the card. */
  final?: boolean;
  /** Split across the two figures on purpose: a test that reads one element
   *  holding "$3.39/W · $33,850" and strips the punctuation gets 3.3933850. */
  ppwTestId?: string;
  totalTestId?: string;
}) {
  // Only the two summary rungs are ruled off. A line under every row turns a
  // short ladder into a grid and makes the one that matters weigh the same as
  // the rest.
  const rule = isFinal
    ? "border-t-2 border-border pt-2.5"
    : strong
      ? "border-t border-border pt-2"
      : "";
  const cell = cn("py-1 align-baseline", rule);

  return (
    <tr
      className={cn(
        (strong || isFinal) && "font-semibold",
        muted && "text-muted-foreground",
        isFinal && "text-foreground"
      )}
    >
      <th
        scope="row"
        className={cn(cell, "pr-4 text-left", strong || isFinal ? "font-semibold" : "font-normal")}
      >
        <span className={cn("text-xs", !strong && !isFinal && "text-muted-foreground")}>
          {label}
        </span>
        {note && (
          <span className="block text-[10px] font-normal leading-tight text-muted-foreground">
            {note}
          </span>
        )}
      </th>
      {/* Rounded to the nearest cent BEFORE the decimal is placed. A rate of
          338.5 cents a watt is a real outcome — $3.00 base with $3,850 of
          adders on 10 kW — and `(338.5 / 100).toFixed(2)` answers "3.38",
          because 3.385 is not representable and lands a hair below. The rate a
          rep is measured on should not be a cent light because of binary
          floating point. */}
      <td className={cn(cell, "pl-6 text-right tabular-nums")}>
        <span
          data-testid={ppwTestId}
          className={cn(isFinal ? "text-sm" : "text-xs", !strong && !isFinal && "opacity-70")}
        >
          {ppw == null ? "—" : `$${(Math.round(ppw) / 100).toFixed(2)}`}
        </span>
      </td>
      <td className={cn(cell, "pl-8 text-right tabular-nums")}>
        <span
          data-testid={totalTestId}
          className={cn(
            isFinal ? "font-display text-lg" : strong ? "font-display text-base" : "text-sm"
          )}
        >
          {total == null ? "—" : `$${Math.round(total / 100).toLocaleString()}`}
        </span>
      </td>
    </tr>
  );
}

// ---------------------------------------------------------------------------
// Storage
// ---------------------------------------------------------------------------

/**
 * The same price card on a deal with no watts.
 *
 * A SEPARATE component rather than a unit parameter on the card above. That one
 * is seven hundred lines of per-watt reasoning — the cap solve, the band, the
 * "you are off default" note, the footer that reads `$3.39/W · $33,850` — and
 * every one of them says "watt" for a reason a battery does not share. Threading
 * a unit through it would leave one component whose every sentence had to be
 * true of both, which is how a card ends up saying nothing about either.
 *
 * The LADDER is shared, and that is the part that matters: both cards read
 * `priceUnits` through their own entry point, so the two cannot disagree about
 * what a dealer fee does.
 */
export function StoragePriceCard({
  batteryQty,
  basePerBatteryCents,
  quotedFeePct,
  quotedMaxFinalPerBatteryCents,
  quotedFinalBatteryPriceMode,
  quotedMinBasePerBatteryCents,
  quotedLabel,
  adderTotalCents,
  onTopAdderTotalCents = 0,
  canEdit,
  onChange,
}: {
  batteryQty: number;
  /** What the rep prices ONE battery at, before any lender's cut. Null = empty. */
  basePerBatteryCents: number | null;
  quotedFeePct: number | null;
  quotedMaxFinalPerBatteryCents: number | null;
  quotedFinalBatteryPriceMode: "cap" | "flat";
  quotedMinBasePerBatteryCents: number | null;
  quotedLabel: string | null;
  adderTotalCents: number;
  onTopAdderTotalCents?: number;
  canEdit: boolean;
  onChange: (cents: number | null) => void;
}) {
  const fee = quotedFeePct ?? 0;
  const sticker = basePerBatteryCents == null ? null : grossPpwFromNet(basePerBatteryCents, fee);

  const cap =
    sticker == null
      ? null
      : capStickerToFinalUnit({
          stickerPerUnitCents: sticker,
          maxFinalPerUnitCents: quotedMaxFinalPerBatteryCents,
          mode: quotedFinalBatteryPriceMode,
          units: batteryQty,
          dealerFeePct: fee,
          adderTotalCents,
        });

  const breakdown =
    sticker == null || !(batteryQty > 0)
      ? null
      : priceStoragePurchase({
          product: fee > 0 ? "loan" : "cash",
          batteryQty,
          stickerPricePerBatteryCents: cap?.stickerPerUnitCents ?? sticker,
          dealerFeePct: fee,
          adderTotalCents,
          onTopAdderTotalCents,
        });

  // Measured on what SURVIVES the partner's rule, not on what was typed. Under
  // a flat partner the base a rep entered is not the base anybody is getting.
  const keptPerBattery =
    cap == null ? null : basePpwFromSticker(cap.stickerPerUnitCents, fee);
  const underFloor =
    keptPerBattery != null &&
    quotedMinBasePerBatteryCents != null &&
    quotedMinBasePerBatteryCents > 0 &&
    keptPerBattery < quotedMinBasePerBatteryCents;

  return (
    <section className="space-y-3 rounded-xl border border-border bg-card p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What we charge
          </h4>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Priced per battery. {batteryQty > 0
              ? `${batteryQty} on this deal.`
              : "Pick a battery on the Storage step first."}
          </p>
        </div>
        <label className="space-y-1">
          <span className="block text-xs text-muted-foreground">Base $ per battery</span>
          <input
            type="text"
            inputMode="decimal"
            className="h-10 w-40 rounded-md border border-border bg-background px-2 text-right text-lg tabular-nums disabled:opacity-50"
            disabled={!canEdit}
            defaultValue={basePerBatteryCents == null ? "" : String(Math.round(basePerBatteryCents / 100))}
            placeholder="13,000"
            onBlur={(e) => {
              const t = e.target.value.trim().replace(/[$,]/g, "");
              if (t === "") return onChange(null);
              const n = Number(t);
              if (Number.isFinite(n) && n > 0) onChange(Math.round(n * 100));
            }}
          />
        </label>
      </div>

      {breakdown && (
        <dl className="space-y-1 border-t border-border pt-3 text-sm">
          <Row
            label={`Batteries — ${batteryQty} × ${money(
              Math.round(breakdown.baseStickerCents / Math.max(1, batteryQty))
            )}`}
            value={money(breakdown.baseStickerCents)}
          />
          {breakdown.adderStickerCents !== 0 && (
            <Row label="Additional work" value={money(breakdown.adderStickerCents)} />
          )}
          <Row label="What we keep" value={money(breakdown.grossPriceCents)} muted />
          {breakdown.dealerFeeCents !== 0 && (
            <Row
              label={`Lender fee${quotedLabel ? ` — ${quotedLabel}` : ""}`}
              value={money(breakdown.dealerFeeCents)}
              muted
            />
          )}
          <Row label="Customer signs" value={money(breakdown.contractPriceCents)} strong />
        </dl>
      )}

      {cap?.capped && (
        <p className="rounded-lg border border-blue-500/40 bg-blue-500/5 p-2.5 text-xs">
          {quotedFinalBatteryPriceMode === "flat"
            ? `This partner sells at a flat ${money(quotedMaxFinalPerBatteryCents ?? 0)} a battery, fee and work included — so the price above is theirs, not the one typed.`
            : `Held down to this partner's ${money(quotedMaxFinalPerBatteryCents ?? 0)} a battery ceiling. Extra work comes out of what you keep, not out of the customer's price.`}
        </p>
      )}

      {cap?.adderOverrun && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs">
          The extra work alone is above this partner&rsquo;s ceiling. No battery price gets this
          contract under it.
        </p>
      )}

      {underFloor && (
        <p className="rounded-lg border border-red-500/40 bg-red-500/5 p-2.5 text-xs">
          This leaves {money(keptPerBattery ?? 0)} a battery before the lender&rsquo;s cut, under
          the {money(quotedMinBasePerBatteryCents ?? 0)} minimum. The proposal will not generate
          until this comes up.
        </p>
      )}
    </section>
  );
}

const money = (cents: number) =>
  (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });

function Row({
  label,
  value,
  muted,
  strong,
}: {
  label: string;
  value: string;
  muted?: boolean;
  strong?: boolean;
}) {
  return (
    <div
      className={`flex items-baseline justify-between gap-4 ${
        strong ? "border-t border-border pt-1.5 font-semibold" : ""
      } ${muted ? "text-muted-foreground" : ""}`}
    >
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
