"use client";

import * as React from "react";
import {
  postSolarUtilityCents,
  vppCreditCents,
  type SavingsYear,
  type VppCredit,
} from "@/lib/solar-proposal";
import { usd } from "./format";

/**
 * Twenty-five years, one year at a time — and the arithmetic that makes each one.
 *
 * The 25-year table is the proof and it is also a wall of numbers — some
 * households read one, some read the other, and nobody reads a hundred cells on
 * a phone. This is the same model with a handle on it: drag to a year and see
 * what that year costs both ways, and what has accumulated by then.
 *
 * It used to show three bare figures side by side — "Utility, that year",
 * "With solar, that year", "Utility bill that year" — and a homeowner could not
 * tell the first from the third (one is the bill they escape, the other is the
 * bill they still get) or work out why the second was SMALLER than the third,
 * or negative. The missing number was the battery programme's, subtracted
 * silently. A figure a customer cannot trace is a figure they stop believing,
 * so the card now shows the subtraction rather than only its result.
 *
 * READS THE FROZEN MODEL. Every row was computed on the server at generation
 * and is the same array the table below renders; the only arithmetic here is
 * subtracting two frozen figures to name their difference. The slider selects;
 * it never calculates. A projection a customer can move is a projection that no
 * longer records what they were shown.
 */
export function SavingsScrubber({
  years,
  paybackYear,
  vpp = [],
}: {
  years: SavingsYear[];
  /** Highlighted on the track, when the model has one. */
  paybackYear: number | null;
  /**
   * The battery programmes already priced into these rows, so the breakdown can
   * name who is paying rather than showing an unexplained credit.
   */
  vpp?: VppCredit[];
}) {
  const last = years.length;
  const [year, setYear] = React.useState(1);
  const row = years[Math.min(year, last) - 1];
  if (!row || last === 0) return null;

  const positive = row.cumulativeSavingsCents >= 0;
  // Where the payback marker sits on the track, as a percentage of its length.
  const markerPct =
    paybackYear && last > 1 ? ((paybackYear - 1) / (last - 1)) * 100 : null;

  // The three parts of "with solar", exactly as the model added them up:
  //   grid bill + system payment − battery programme = what you pay that year.
  const gridBill = postSolarUtilityCents(row);
  const systemPayment = row.solarPaymentCents;
  const battery = vppCreditCents(row);
  const keptThisYear = row.utilityCostCents - row.solarCostCents;

  /**
   * Whether this document prices the system as one payment in year one — a cash
   * purchase, or a loan whose payments are quoted elsewhere on the page. Read
   * off the frozen rows rather than passed in, because the rows already say it:
   * a price in year one and nothing afterwards is what that shape looks like,
   * and a lease or PPA never has it.
   */
  const paidUpFront =
    last > 1 && years[0].solarPaymentCents > 0 && years[1].solarPaymentCents === 0;

  const systemLabel = paidUpFront
    ? row.year === 1
      ? "The system itself, paid for this year"
      : "The system — already paid for in year one"
    : "What you pay for the system this year";

  const batteryLabel =
    vpp.length === 1
      ? `${vpp[0].programme} pays you for your battery`
      : "Battery programmes pay you";

  // Only worth showing when it explains something. With no battery and no
  // payment left to make, "with solar" simply IS the remaining utility bill and
  // a one-line breakdown of it is noise.
  const showBreakdown = battery > 0 || systemPayment > 0;

  return (
    <figure className="mt-10 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60 sm:p-8 print:hidden">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
          {positive ? "Total kept by the end of year" : "Still to make back by the end of year"}
        </span>
        <span className="font-display text-2xl font-bold tabular-nums text-neutral-900">
          {row.year}
        </span>
      </figcaption>

      <p
        className={
          positive
            ? "mt-4 font-display text-5xl font-bold leading-none tracking-tight text-neutral-900 sm:text-7xl"
            : "mt-4 font-display text-5xl font-bold leading-none tracking-tight text-amber-700 sm:text-7xl"
        }
      >
        {/* The minus sign is redundant beside "still to make back", and reads as
            a loss rather than a balance still owed on something already bought. */}
        {usd(Math.abs(row.cumulativeSavingsCents))}
      </p>
      <p className="mt-3 max-w-[54ch] text-sm leading-relaxed text-neutral-500">
        {positive
          ? `Everything you kept in years 1–${row.year}, after paying for the system, versus staying with the utility for the same years.`
          : paybackYear != null
            ? `The system has not paid for itself yet at this point. On these assumptions it does in year ${paybackYear}, and every year after that is money kept.`
            : "The system has not paid for itself yet at this point."}
      </p>

      {/* The handle. A native range input: it works with a keyboard, it works
          with a screen reader, and on a phone it is the control the person
          already knows how to use. */}
      <div className="relative mt-8">
        {markerPct != null && (
          <span
            className="pointer-events-none absolute -top-1.5 z-0 h-5 w-0.5 -translate-x-1/2 rounded-full bg-[var(--proposal-accent)]"
            style={{ left: `${markerPct}%` }}
            aria-hidden
          />
        )}
        <input
          type="range"
          min={1}
          max={last}
          step={1}
          value={year}
          onChange={(e) => setYear(Number(e.target.value))}
          aria-label="Year"
          className="relative z-10 w-full cursor-pointer appearance-none bg-transparent [&::-moz-range-thumb]:size-6 [&::-moz-range-thumb]:cursor-grab [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:border-0 [&::-moz-range-thumb]:bg-neutral-900 [&::-moz-range-track]:h-2 [&::-moz-range-track]:rounded-full [&::-moz-range-track]:bg-neutral-200 [&::-webkit-slider-runnable-track]:h-2 [&::-webkit-slider-runnable-track]:rounded-full [&::-webkit-slider-runnable-track]:bg-neutral-200 [&::-webkit-slider-thumb]:-mt-2 [&::-webkit-slider-thumb]:size-6 [&::-webkit-slider-thumb]:cursor-grab [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-neutral-900 [&::-webkit-slider-thumb]:shadow-md"
        />
        <div className="mt-2 flex justify-between text-xs font-medium text-neutral-400">
          <span>Year 1</span>
          {paybackYear != null && (
            <span className="text-[var(--proposal-accent)]">Pays for itself · year {paybackYear}</span>
          )}
          <span>Year {last}</span>
        </div>
      </div>

      {/* ── That one year, both ways ──────────────────────────────────────
          Two figures and their difference, in the order the question is asked:
          what would the utility have charged, what do you pay instead, what is
          left over. The old three-cell row put the answer between its own two
          inputs and named two different things "utility". */}
      <div className="mt-8 rounded-2xl bg-neutral-50 p-5 ring-1 ring-neutral-900/[0.06] sm:p-6">
        <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
          Year {row.year} on its own
        </p>
        <dl className="mt-4">
          <Line k="Staying with the utility" v={usd(row.utilityCostCents)} />
          <Line k="Going solar — everything you pay" v={usd(row.solarCostCents)} />
          <Line
            k={keptThisYear >= 0 ? `You keep, in year ${row.year}` : `You pay out, in year ${row.year}`}
            v={usd(Math.abs(keptThisYear))}
            total
            good={keptThisYear >= 0}
          />
        </dl>

        {showBreakdown && (
          <div className="mt-5 border-t border-neutral-900/10 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-400">
              What that {usd(row.solarCostCents)} is made of
            </p>
            <dl className="mt-3">
              <Line k="Power you still buy from the utility" v={usd(gridBill)} muted />
              <Line k={systemLabel} v={usd(systemPayment)} muted />
              {battery > 0 && (
                <Line
                  k={
                    row.year === 1 && vpp.some((v) => v.upfrontCents > 0)
                      ? `${batteryLabel}, including the one-off enrolment payment`
                      : batteryLabel
                  }
                  v={`−${usd(battery)}`}
                  muted
                  good
                />
              )}
            </dl>
            {/* A negative "with solar" is arithmetically correct and reads as a
                mistake. Say what it means before the customer asks. */}
            {row.solarCostCents < 0 && (
              <p className="mt-3 max-w-[54ch] text-sm leading-relaxed text-neutral-600">
                That year the battery programme pays you more than the power you still buy costs,
                so your electricity does not cost you anything at all — it pays you the difference.
              </p>
            )}
          </div>
        )}
      </div>
    </figure>
  );
}

/** One line of the ledger: label left, money right, ruled off when it is a sum. */
function Line({
  k,
  v,
  total = false,
  muted = false,
  good = false,
}: {
  k: string;
  v: string;
  total?: boolean;
  muted?: boolean;
  good?: boolean;
}) {
  return (
    <div
      className={
        total
          ? "mt-2 flex items-baseline justify-between gap-6 border-t border-neutral-900/15 pt-3"
          : "flex items-baseline justify-between gap-6 py-1.5"
      }
    >
      <dt
        className={
          muted
            ? "text-sm leading-snug text-neutral-500"
            : total
              ? "text-sm font-semibold text-neutral-900"
              : "text-sm leading-snug text-neutral-600"
        }
      >
        {k}
      </dt>
      <dd
        className={
          total
            ? good
              ? "shrink-0 font-display text-2xl font-bold tabular-nums text-neutral-900"
              : "shrink-0 font-display text-2xl font-bold tabular-nums text-amber-700"
            : good
              ? "shrink-0 text-base font-semibold tabular-nums text-[var(--proposal-accent)]"
              : "shrink-0 text-base font-semibold tabular-nums text-neutral-900"
        }
      >
        {v}
      </dd>
    </div>
  );
}
