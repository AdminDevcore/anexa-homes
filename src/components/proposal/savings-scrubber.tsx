"use client";

import * as React from "react";
import { postSolarUtilityCents, type SavingsYear } from "@/lib/solar-proposal";
import { usd } from "./format";

/**
 * Twenty-five years, one year at a time.
 *
 * The 25-year table is the proof and it is also a wall of numbers — some
 * households read one, some read the other, and nobody reads a hundred cells on
 * a phone. This is the same model with a handle on it: drag to a year and see
 * what that year costs both ways, and what has accumulated by then.
 *
 * READS THE FROZEN MODEL. Every row was computed on the server at generation
 * and is the same array the table below renders. The slider selects; it never
 * calculates. A projection a customer can move is a projection that no longer
 * records what they were shown.
 */
export function SavingsScrubber({
  years,
  paybackYear,
}: {
  years: SavingsYear[];
  /** Highlighted on the track, when the model has one. */
  paybackYear: number | null;
}) {
  const last = years.length;
  const [year, setYear] = React.useState(1);
  const row = years[Math.min(year, last) - 1];
  if (!row || last === 0) return null;

  const positive = row.cumulativeSavingsCents >= 0;
  // Where the payback marker sits on the track, as a percentage of its length.
  const markerPct =
    paybackYear && last > 1 ? ((paybackYear - 1) / (last - 1)) * 100 : null;

  return (
    <figure className="mt-10 rounded-3xl bg-white p-6 shadow-sm ring-1 ring-neutral-200/60 sm:p-8 print:hidden">
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
        <span className="text-xs font-semibold uppercase tracking-[0.18em] text-neutral-400">
          By the end of year
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
        {usd(row.cumulativeSavingsCents)}
      </p>
      <p className="mt-3 text-sm leading-relaxed text-neutral-500">
        {positive
          ? "kept, versus staying with the utility for the same period."
          : "still to make back. The system has not paid for itself yet at this point."}
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

      <dl className="mt-8 grid grid-cols-1 gap-px overflow-hidden rounded-2xl bg-neutral-200/70 sm:grid-cols-3">
        <Cell k="Utility, that year" v={usd(row.utilityCostCents)} />
        <Cell k="With solar, that year" v={usd(row.solarCostCents)} />
        <Cell k="Utility bill that year" v={usd(postSolarUtilityCents(row))} />
      </dl>
    </figure>
  );
}

function Cell({ k, v }: { k: string; v: string }) {
  return (
    <div className="bg-white px-5 py-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.15em] text-neutral-400">{k}</dt>
      <dd className="mt-1 text-xl font-semibold tabular-nums text-neutral-900">{v}</dd>
    </div>
  );
}
