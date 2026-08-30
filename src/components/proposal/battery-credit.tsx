import type { VppCredit } from "@/lib/solar-proposal";
import { cn } from "@/lib/utils";
import { usd } from "./format";

/**
 * WHICH GROUND THIS CARD IS SITTING ON.
 *
 * It was written for the dark cost chapter and hard-coded white type. The
 * 2026-08-30 rebuild moved it beside the payment, which is a PAPER sheet, and
 * it printed as pale grey on cream — legible on a screen at full brightness and
 * very nearly invisible on paper. A component that carries a warning sentence
 * is the last one in the document allowed to be hard to read.
 */
export type BatteryCreditTone = "dark" | "paper";

/**
 * What the battery earns, on its own line, next to the payment it offsets.
 *
 * The programme's money was already inside every figure on this document —
 * subtracted from the solar column, folded into the lifetime saving, quietly
 * bringing payback forward a year. That is arithmetically right and it is
 * useless to a household at a kitchen table: they could see the total move and
 * could not see what moved it, and a number a customer cannot trace is a number
 * they stop believing.
 *
 * So the credit is shown as a subtraction they can follow, in the chapter where
 * the payment lives:
 *
 *     your payment × 12 − what the programme pays = what the year costs you
 *
 * WITH ONE RULE ABOVE ALL OTHERS. The loan payment stays the headline and the
 * net figure never replaces it. A homeowner who reads "$117 a month" and signs
 * for $150 finds out from a bank statement, and every solar company that has
 * ever done that to somebody did it exactly this way — by netting an incentive
 * into a payment and printing the smaller number in the larger type. The
 * lender is owed the payment in full, every month, whatever the utility does
 * with the battery; that sentence is on the card, not in the small print.
 */
export function BatteryCredit({
  vpp,
  monthlyCents,
  lender,
  tone = "dark",
}: {
  tone?: BatteryCreditTone;
  /** The programmes already priced into this document. Empty renders nothing. */
  vpp: VppCredit[];
  /** The loan or lease payment, cents. Null on cash — there is none to offset. */
  monthlyCents: number | null;
  /** Who the payment is owed to, when the document knows. */
  lender: string | null;
}) {
  const annualCents = vpp.reduce((n, v) => n + v.annualCents, 0);
  const upfrontCents = vpp.reduce((n, v) => n + v.upfrontCents, 0);
  if (annualCents <= 0 && upfrontCents <= 0) return null;

  const payer = vpp.length === 1 ? vpp[0].provider : "your battery programme";
  const programme = vpp.length === 1 ? vpp[0].programme : "Battery programmes";
  const batteries = vpp.reduce((n, v) => Math.max(n, v.batteryQty), 0);
  /**
   * Per battery, only where the arithmetic is honest: one programme, a known
   * count, and a figure that divides into it. Several programmes on one house
   * do not share a per-battery rate, and printing an average of them would be
   * inventing a term nobody published.
   */
  const perBatteryCents =
    vpp.length === 1 && batteries > 1 && annualCents % batteries === 0
      ? annualCents / batteries
      : null;

  // The year, both ways. Only where there is a payment to net against — a cash
  // purchase has no monthly, so the ladder has nothing to stand on and the card
  // states the money plainly instead.
  const yearOfPayments = monthlyCents != null ? monthlyCents * 12 : null;
  const netYearCents = yearOfPayments != null ? yearOfPayments - annualCents : null;
  const dark = tone === "dark";

  return (
    <div
      className={cn(
        "break-inside-avoid overflow-hidden rounded-2xl border",
        dark ? "border-white/10 bg-white/[0.04]" : "border-neutral-900/12 bg-white",
      )}
    >
      <div className={cn("border-b px-5 py-3", dark ? "border-white/10" : "border-neutral-900/10")}>
        {/* The eyebrow used to read "Your battery earns its keep" directly over
            "Your battery earns you $600 a year" — the same sentence twice, and
            twenty-four pixels this card could not spare. */}
        <p
          className={cn(
            "font-display text-lg font-bold",
            dark ? "text-white" : "text-neutral-950",
          )}
        >
          Your battery earns you {usd(annualCents)} a year
        </p>
        {/* WHO PAYS IS NOT IN THE DATA, so this no longer claims to know.
            A provider row is a TERRITORY — this company files the same
            programme under five different utilities — and the sentence used to
            read "<utility> pays you", naming the wires company for a
            retailer's programme. What IS known: the programme, the network the
            battery is enrolled on, and what it pays. */}
        <p
          className={cn(
            "mt-1 text-[0.8rem] leading-relaxed",
            dark ? "text-neutral-400" : "text-neutral-600",
          )}
        >
          Enrolled in {programme} on {payer}&rsquo;s network, and paid for letting them draw on it
          when the grid is short
          {batteries > 1 ? ` — ${batteries} batteries` : ""}
          {perBatteryCents != null ? `, at ${usd(perBatteryCents)} each` : ""}
          {upfrontCents > 0 ? `, plus ${usd(upfrontCents)} when you enrol` : ""}.
        </p>
      </div>

      {yearOfPayments != null && annualCents > 0 && netYearCents != null ? (
        <dl className={cn("divide-y", dark ? "divide-white/10" : "divide-neutral-900/8")}>
          <Row dark={dark} k="Your payment" v={`${usd(monthlyCents!, 2)} a month`} />
          <Row dark={dark} k="Twelve of them, over a year" v={usd(yearOfPayments)} />
          <Row dark={dark} k={`${programme} pays you`} v={`−${usd(annualCents)}`} credit />
          <Row
            dark={dark}
            k="What the year costs you, after the programme"
            v={usd(Math.abs(netYearCents))}
            strong
          />
          <Row
            dark={dark}
            k="Which works out at"
            v={`${usd(Math.round(netYearCents / 12), 2)} a month`}
            muted
          />
        </dl>
      ) : (
        <dl className={cn("divide-y", dark ? "divide-white/10" : "divide-neutral-900/8")}>
          <Row dark={dark} k="Every year" v={usd(annualCents)} />
          {upfrontCents > 0 && <Row dark={dark} k="Once, when you enrol" v={usd(upfrontCents)} />}
        </dl>
      )}

      {/* THE SENTENCE THIS CARD EXISTS FOR. Read it before changing anything
          above it: the net figure is what the year costs, the payment is what
          is owed, and the two must never be allowed to swap places. */}
      {yearOfPayments != null && annualCents > 0 && (
        <div
          className={cn(
            "border-t px-5 py-3",
            dark ? "border-white/10" : "border-neutral-900/10 bg-amber-50",
          )}
        >
          <p
            className={cn(
              "max-w-[62ch] text-[0.8rem] leading-relaxed",
              dark ? "text-amber-200" : "text-amber-900",
            )}
          >
            <strong className={cn("font-semibold", dark ? "text-amber-100" : "text-amber-950")}>
              Your payment does not change.
            </strong>{" "}
            You owe {lender ?? "your lender"} {usd(monthlyCents!, 2)} every month for the system,
            whatever the battery earns. The {usd(annualCents)} is separate money the programme
            pays you — it is what the year nets out to, not a smaller bill from the bank.
          </p>
        </div>
      )}
    </div>
  );
}

/** One line of the ladder. The credit is the only thing that wears the accent. */
function Row({
  k,
  v,
  strong,
  muted,
  credit,
  dark,
}: {
  k: string;
  v: string;
  strong?: boolean;
  muted?: boolean;
  credit?: boolean;
  dark: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-baseline justify-between gap-6 px-5 py-2",
        strong && (dark ? "bg-white/[0.06]" : "bg-neutral-900/[0.04]"),
      )}
    >
      <dt
        className={cn(
          "text-[0.85rem]",
          muted
            ? dark
              ? "text-neutral-400"
              : "text-neutral-500"
            : strong
              ? dark
                ? "font-semibold text-white"
                : "font-semibold text-neutral-950"
              : dark
                ? "text-neutral-300"
                : "text-neutral-600",
        )}
      >
        {k}
      </dt>
      <dd
        className={cn(
          "shrink-0 tabular-nums",
          strong
            ? cn("font-display text-base font-bold", dark ? "text-white" : "text-neutral-950")
            : credit
              ? "font-medium text-[var(--proposal-accent)]"
              : muted
                ? cn("text-[0.85rem] font-medium", dark ? "text-neutral-300" : "text-neutral-500")
                : cn("text-[0.9rem] font-medium", dark ? "text-white" : "text-neutral-900"),
        )}
      >
        {v}
      </dd>
    </div>
  );
}
