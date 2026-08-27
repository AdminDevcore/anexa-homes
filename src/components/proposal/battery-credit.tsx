import type { VppCredit } from "@/lib/solar-proposal";
import { usd } from "./format";

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
}: {
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

  return (
    <div className="mt-8 break-inside-avoid overflow-hidden rounded-2xl border border-white/10 bg-white/[0.04]">
      <div className="border-b border-white/10 px-5 py-4">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-[var(--proposal-accent)]">
          Your battery earns its keep
        </p>
        <p className="mt-2 font-display text-xl font-bold text-white">
          {programme} pays you {usd(annualCents)} a year
        </p>
        <p className="mt-1 text-sm leading-relaxed text-neutral-400">
          {payer} pays you for letting them draw on your battery
          {batteries > 1 ? ` — ${batteries} batteries` : ""}
          {perBatteryCents != null ? `, at ${usd(perBatteryCents)} each` : ""}
          {upfrontCents > 0 ? `, plus ${usd(upfrontCents)} when you enrol` : ""}.
        </p>
      </div>

      {yearOfPayments != null && annualCents > 0 && netYearCents != null ? (
        <dl className="divide-y divide-white/10">
          <Row k="Your payment" v={`${usd(monthlyCents!, 2)} a month`} />
          <Row k="Twelve of them, over a year" v={usd(yearOfPayments)} />
          <Row k={`${programme} pays you`} v={`−${usd(annualCents)}`} credit />
          <Row
            k="What the year costs you, after the programme"
            v={usd(Math.abs(netYearCents))}
            strong
          />
          <Row
            k="Which works out at"
            v={`${usd(Math.round(netYearCents / 12), 2)} a month`}
            muted
          />
        </dl>
      ) : (
        <dl className="divide-y divide-white/10">
          <Row k="Every year" v={usd(annualCents)} />
          {upfrontCents > 0 && <Row k="Once, when you enrol" v={usd(upfrontCents)} />}
        </dl>
      )}

      {/* THE SENTENCE THIS CARD EXISTS FOR. Read it before changing anything
          above it: the net figure is what the year costs, the payment is what
          is owed, and the two must never be allowed to swap places. */}
      {yearOfPayments != null && annualCents > 0 && (
        <div className="border-t border-white/10 px-5 py-4">
          <p className="max-w-[62ch] text-sm leading-relaxed text-amber-200">
            <strong className="font-semibold text-amber-100">Your payment does not change.</strong>{" "}
            You owe {lender ?? "your lender"} {usd(monthlyCents!, 2)} every month for the system,
            whatever the battery earns. The {usd(annualCents)} is separate money {payer} pays you
            — it is what the year nets out to, not a smaller bill from the bank.
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
}: {
  k: string;
  v: string;
  strong?: boolean;
  muted?: boolean;
  credit?: boolean;
}) {
  return (
    <div
      className={
        strong
          ? "flex items-baseline justify-between gap-6 bg-white/[0.06] px-5 py-3.5"
          : "flex items-baseline justify-between gap-6 px-5 py-3"
      }
    >
      <dt
        className={
          muted
            ? "text-sm text-neutral-400"
            : strong
              ? "font-semibold text-white"
              : "text-neutral-300"
        }
      >
        {k}
      </dt>
      <dd
        className={
          strong
            ? "shrink-0 font-display text-lg font-bold tabular-nums text-white"
            : credit
              ? "shrink-0 font-medium tabular-nums text-[var(--proposal-accent)]"
              : muted
                ? "shrink-0 text-sm font-medium tabular-nums text-neutral-300"
                : "shrink-0 font-medium tabular-nums text-white"
        }
      >
        {v}
      </dd>
    </div>
  );
}
