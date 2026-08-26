"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SavingsYear } from "@/lib/solar-proposal";
import { usd, usdCompact } from "../format";

/**
 * The two series in the cost comparison.
 *
 * Chosen against the document's own paper (#f6f3ee) with the palette validator,
 * not by eye: amber-700 and emerald-700 clear the lightness band, the chroma
 * floor, the normal-vision floor (ΔE 21.9) and 3:1 contrast, and land in the
 * 6–8 protan band that is legal only WITH secondary encoding — which is why
 * both series are named in the legend, totalled in words beneath the plot, and
 * repeated in the table below it. Colour is never the only thing carrying the
 * difference.
 */
const UTILITY_INK = "#b45309";
const SOLAR_INK = "#047857";

/* ══════════════════════════════════════════════════════════════════════════
   The comparison chart
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Utility vs solar, as CUMULATIVE spend over the modelled horizon.
 *
 * Deliberately not the per-year bars this used to draw. On a cash or loan deal
 * year one carries the whole contract price, so a chart scaled to the largest
 * single year rendered one enormous bar and twenty-four slivers — the argument
 * was invisible in the picture that existed to make it.
 *
 * Running totals fix that and tell the real story besides: two rising lines,
 * the solar one stepping up front and then flattening, the utility one
 * compounding past it. Where they cross is the payback year, and the gap at the
 * right-hand edge IS the net saving quoted at the top of the document.
 *
 * All text lives in HTML around the plot rather than inside the SVG, so nothing
 * shrinks to 5px when the chart scales down on a phone.
 */
export function CumulativeCostChart({
  years,
  paybackYear,
}: {
  years: SavingsYear[];
  paybackYear: number | null;
}) {
  const W = 720;
  const H = 260;
  const PAD_T = 10;
  const PAD_B = 10;

  const { utilityPts, solarPts, utilityTotal, solarTotal, span } = React.useMemo(() => {
    let u = 0;
    let s = 0;
    const uPts: [number, number][] = [];
    const sPts: [number, number][] = [];
    for (const y of years) {
      u += y.utilityCostCents;
      s += y.solarCostCents;
      uPts.push([y.year, u]);
      sPts.push([y.year, s]);
    }
    return {
      utilityPts: uPts,
      solarPts: sPts,
      utilityTotal: u,
      solarTotal: s,
      span: Math.max(u, s, 1),
    };
  }, [years]);

  if (years.length < 2) return null;

  const lastYear = years[years.length - 1].year;
  const x = (year: number) => ((year - 1) / (lastYear - 1)) * W;
  const y = (cents: number) => H - PAD_B - (cents / span) * (H - PAD_T - PAD_B);
  const pctX = (year: number) => (x(year) / W) * 100;
  const pctY = (cents: number) => (y(cents) / H) * 100;

  const path = (pts: [number, number][]) =>
    pts.map(([yr, c], i) => `${i === 0 ? "M" : "L"}${x(yr).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");

  /**
   * The gap between the lines, split AT THE CROSSOVER.
   *
   * One flat emerald wash over the whole gap would have tinted the years before
   * payback — when the solar line is still the higher of the two — the colour
   * this document uses for money kept. Those years are the opposite of a
   * saving, so they get the utility's own colour and the wash only turns green
   * once the customer is genuinely ahead. The crossing point is interpolated
   * rather than snapped to a year boundary, so the two washes meet exactly
   * where the lines do.
   */
  const bands: { ahead: boolean; d: string }[] = [];
  {
    let cur: { ahead: boolean; pts: [number, number, number][] } | null = null;
    const close = () => {
      if (cur && cur.pts.length > 1) {
        const fwd = cur.pts
          .map(([yr, u], i) => `${i === 0 ? "M" : "L"}${x(yr).toFixed(1)} ${y(u).toFixed(1)}`)
          .join(" ");
        const back = [...cur.pts]
          .reverse()
          .map(([yr, , sv]) => `L${x(yr).toFixed(1)} ${y(sv).toFixed(1)}`)
          .join(" ");
        bands.push({ ahead: cur.ahead, d: `${fwd} ${back} Z` });
      }
    };
    for (let i = 0; i < utilityPts.length; i++) {
      const [yr, u] = utilityPts[i];
      const sv = solarPts[i][1];
      const ahead = u >= sv;
      if (cur && cur.ahead !== ahead) {
        // Where the two lines actually cross, between this point and the last.
        const [pYr, pU] = utilityPts[i - 1];
        const pS = solarPts[i - 1][1];
        const denom = pU - pS - (u - sv);
        const t = denom === 0 ? 0 : (pU - pS) / denom;
        const cx = pYr + t * (yr - pYr);
        const cv = pU + t * (u - pU);
        cur.pts.push([cx, cv, cv]);
        close();
        cur = { ahead, pts: [[cx, cv, cv]] };
      } else if (!cur) {
        cur = { ahead, pts: [] };
      }
      cur.pts.push([yr, u, sv]);
    }
    close();
  }

  const ticks = years.map((yr) => yr.year).filter((n) => n === 1 || n % 5 === 0 || n === lastYear);

  /** Edge-aware alignment, so the first and last labels stay inside the card. */
  const align = (p: number) =>
    p <= 2 ? "translate-x-0" : p >= 98 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <figure className="mt-10">
      <figcaption className="mb-5 flex flex-wrap items-baseline gap-x-8 gap-y-2">
        <span className="text-sm font-semibold text-neutral-900">
          What you will have spent, year by year
        </span>
        <span className="text-xs text-neutral-500">
          Running totals over {years.length} years, including any grid power still bought.
        </span>
      </figcaption>

      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-neutral-200/60 sm:p-7">
        {/* The payback flag gets its own row so it never sits on the data. */}
        <div className="relative mb-1 h-6 pl-12">
          {paybackYear != null && (
            <span
              className={cn(
                "absolute top-0 whitespace-nowrap rounded-full bg-neutral-900 px-2.5 py-1 text-[11px] font-medium text-white",
                align(pctX(paybackYear))
              )}
              style={{ left: `${pctX(paybackYear)}%` }}
            >
              Pays for itself · year {paybackYear}
            </span>
          )}
        </div>

        <div className="relative pl-12">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-auto w-full"
            role="img"
            aria-label={`Cumulative cost over ${years.length} years: staying with the utility reaches ${usd(utilityTotal)}, going solar reaches ${usd(solarTotal)}.`}
          >
            {/* Recessive grid — quarters of the range, nothing more. */}
            {[0.25, 0.5, 0.75, 1].map((t) => (
              <line
                key={t}
                x1={0}
                x2={W}
                y1={y(span * t)}
                y2={y(span * t)}
                stroke="#e7e2da"
                strokeWidth={1}
              />
            ))}
            <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#d6d0c6" strokeWidth={1} />

            {bands.map((b, i) => (
              <path
                key={i}
                d={b.d}
                fill={b.ahead ? SOLAR_INK : UTILITY_INK}
                fillOpacity={b.ahead ? 0.1 : 0.07}
              />
            ))}

            {paybackYear != null && (
              <line
                x1={x(paybackYear)}
                x2={x(paybackYear)}
                y1={PAD_T - 6}
                y2={y(0)}
                stroke="#a8a29e"
                strokeWidth={1}
                strokeDasharray="4 4"
              />
            )}

            <path
              d={path(utilityPts)}
              fill="none"
              stroke={UTILITY_INK}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
            <path
              d={path(solarPts)}
              fill="none"
              stroke={SOLAR_INK}
              strokeWidth={2.5}
              strokeLinecap="round"
              strokeLinejoin="round"
            />

            {/* End markers, ringed in the surface colour so they sit on top of
                the lines cleanly. */}
            <circle
              cx={x(lastYear)}
              cy={y(utilityTotal)}
              r={5}
              fill={UTILITY_INK}
              stroke="#ffffff"
              strokeWidth={2}
            />
            <circle
              cx={x(lastYear)}
              cy={y(solarTotal)}
              r={5}
              fill={SOLAR_INK}
              stroke="#ffffff"
              strokeWidth={2}
            />
          </svg>

          {/* The y scale, in HTML — inside the SVG it would shrink with the
              viewBox and be unreadable on a phone. */}
          {[0, 0.5, 1].map((t) => (
            <span
              key={t}
              className="absolute left-0 w-10 -translate-y-1/2 text-right text-[10px] tabular-nums text-neutral-400"
              style={{ top: `${pctY(span * t)}%` }}
            >
              {usdCompact(span * t)}
            </span>
          ))}
        </div>

        {/* X axis, in HTML so it stays legible at any width. */}
        <div className="relative mt-2 h-4 pl-12">
          {ticks.map((t) => (
            <span
              key={t}
              className={cn(
                "absolute text-[11px] tabular-nums text-neutral-400",
                align(pctX(t))
              )}
              style={{ left: `${pctX(t)}%` }}
            >
              {t === 1 ? "Yr 1" : t}
            </span>
          ))}
        </div>

        {/* Legend and direct totals in one row — identity is never colour alone. */}
        <dl className="mt-7 grid gap-4 border-t border-neutral-100 pt-5 sm:grid-cols-2">
          <div>
            <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: UTILITY_INK }}
                aria-hidden
              />
              Staying with the utility
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-900">
              {usd(utilityTotal)}
            </dd>
          </div>
          <div>
            <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
              <span
                className="size-2.5 rounded-full"
                style={{ backgroundColor: SOLAR_INK }}
                aria-hidden
              />
              Going solar
            </dt>
            <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-900">
              {usd(solarTotal)}
            </dd>
          </div>
          {/*
            "The difference" used to be a third column here, printing the net
            figure a few hundred pixels above the block that states it at five
            times the size. The plot's job is the two SERIES it draws; the net
            of them is the document's headline and is claimed exactly once.
          */}
        </dl>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-neutral-500">
        The shaded gap is the difference between the two. It is amber while the system is still
        paying itself back{paybackYear != null ? `, and green from year ${paybackYear} on` : ""}.
      </p>
    </figure>
  );
}
