"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import type { SavingsYear } from "@/lib/solar-proposal";
import { usd, usdCompact } from "../format";

/**
 * The two series in the cost comparison.
 *
 * RE-STEPPED FOR THE DARK PLATE, with the validator rather than by eye. The
 * chart used to sit in a white box on the document's cream paper and was
 * coloured amber-700/emerald-700 against it. It is now the page — a near-black
 * sheet with the drawing running edge to edge — and the old pair was chosen
 * against a surface it no longer touches.
 *
 * amber-600 and teal-600 against #101418: inside the lightness band, over the
 * chroma floor, over 3:1 contrast, and — the reason for the change — a worst
 * adjacent CVD separation of ΔE 12.5 (protan) where the old pair scored 7.9.
 * That number matters: 6–8 is a FLOOR that is legal only because something
 * other than colour also carries the difference, and 12.5 clears it outright.
 *
 * The secondary encoding stays regardless: both series are named in the legend,
 * totalled in words beside it, and repeated in the year table in the back
 * matter. Colour is never the only thing carrying the difference.
 */
const UTILITY_INK = "#d97706";
const SOLAR_INK = "#0d9488";

/** The ground the markers are ringed against, so they sit on top of the lines. */
const PLATE_INK = "#101418";

type Series = {
  utilityPts: [number, number][];
  solarPts: [number, number][];
  utilityTotal: number;
  solarTotal: number;
  span: number;
};

function useSeries(years: SavingsYear[]): Series {
  return React.useMemo(() => {
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
    return { utilityPts: uPts, solarPts: sPts, utilityTotal: u, solarTotal: s, span: Math.max(u, s, 1) };
  }, [years]);
}

/* ══════════════════════════════════════════════════════════════════════════
   The comparison, as the page
   ════════════════════════════════════════════════════════════════════════ */

/**
 * Utility vs solar, as CUMULATIVE spend over the modelled horizon, drawn edge
 * to edge across the sheet.
 *
 * Deliberately not the per-year bars this used to draw. On a cash or loan deal
 * year one carries the whole contract price, so a chart scaled to the largest
 * single year rendered one enormous bar and twenty-four slivers — the argument
 * was invisible in the picture that existed to make it.
 *
 * Running totals fix that and tell the real story besides: two rising lines,
 * the solar one stepping up front and then flattening, the utility one
 * compounding past it. Where they cross is the payback year, and the gap at the
 * right-hand edge IS the net saving quoted in the card.
 *
 * WHY THE VIEWBOX IS STRETCHED. This fills a sheet whose proportions are the
 * paper's, not the drawing's, so `preserveAspectRatio="none"` lets the plot use
 * every inch. Distortion is harmless to what this chart says — two monotonic
 * rising lines and the gap between them — and `vector-effect: non-scaling-stroke`
 * keeps the strokes at their true weight instead of smearing them wide. The end
 * markers and every label are HTML positioned in percentages for the same
 * reason: inside the SVG they would stretch with it.
 */
export function CumulativeCostPlot({
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
  const { utilityPts, solarPts, utilityTotal, solarTotal, span } = useSeries(years);

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
   * One flat wash over the whole gap would have tinted the years before
   * payback — when the solar line is still the higher of the two — the colour
   * this document uses for money kept. Those years are the opposite of a
   * saving, so they get the utility's own colour and the wash only turns cool
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

  /** Edge-aware alignment, so the first and last labels stay inside the sheet. */
  const align = (p: number) =>
    p <= 2 ? "translate-x-0" : p >= 98 ? "-translate-x-full" : "-translate-x-1/2";

  return (
    <div className="relative size-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        className="size-full"
        role="img"
        aria-label={`Cumulative cost over ${years.length} years: staying with the utility reaches ${usd(utilityTotal)}, going solar reaches ${usd(solarTotal)}.`}
      >
        {[0.25, 0.5, 0.75, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={W}
            y1={y(span * t)}
            y2={y(span * t)}
            stroke="rgba(255,255,255,0.09)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
        ))}

        {bands.map((b, i) => (
          <path
            key={i}
            d={b.d}
            fill={b.ahead ? SOLAR_INK : UTILITY_INK}
            fillOpacity={b.ahead ? 0.24 : 0.16}
          />
        ))}

        {paybackYear != null && (
          <line
            x1={x(paybackYear)}
            x2={x(paybackYear)}
            y1={0}
            y2={y(0)}
            stroke="rgba(255,255,255,0.28)"
            strokeWidth={1}
            strokeDasharray="4 4"
            vectorEffect="non-scaling-stroke"
          />
        )}

        <path
          d={path(utilityPts)}
          fill="none"
          stroke={UTILITY_INK}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
        <path
          d={path(solarPts)}
          fill="none"
          stroke={SOLAR_INK}
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>

      {/* ── everything that must not stretch ─────────────────────────────── */}

      {/* The end markers, ringed in the plate's own ground so they read on top
          of the lines. 10px, over the 8px minimum. */}
      {(
        [
          [utilityTotal, UTILITY_INK],
          [solarTotal, SOLAR_INK],
        ] as [number, string][]
      ).map(([total, ink]) => (
        <span
          key={ink}
          aria-hidden
          className="absolute size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
          style={{
            left: "100%",
            top: `${pctY(total)}%`,
            backgroundColor: ink,
            boxShadow: `0 0 0 2px ${PLATE_INK}`,
          }}
        />
      ))}

      {paybackYear != null && (
        <span
          className={cn(
            "absolute top-3 whitespace-nowrap rounded-full bg-white/90 px-2.5 py-1 text-[11px] font-medium text-neutral-900",
            "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
            align(pctX(paybackYear)),
          )}
          style={{ left: `${pctX(paybackYear)}%` }}
        >
          Pays for itself · year {paybackYear}
        </span>
      )}

      {/* The y scale. Inside the SVG it would stretch with the viewBox. */}
      {[0.5, 1].map((t) => (
        <span
          key={t}
          className="absolute left-0 -translate-y-1/2 text-[11px] tabular-nums text-neutral-500"
          style={{ top: `${pctY(span * t)}%` }}
        >
          {usdCompact(span * t)}
        </span>
      ))}

      {/* X axis, along the foot. */}
      {ticks.map((t) => (
        <span
          key={t}
          className={cn("absolute bottom-0 text-[11px] tabular-nums text-neutral-500", align(pctX(t)))}
          style={{ left: `${pctX(t)}%` }}
        >
          {t === 1 ? "Yr 1" : t}
        </span>
      ))}
    </div>
  );
}

/**
 * The legend and the two totals — the SECONDARY ENCODING the palette depends
 * on, and the reason it is exported beside the plot rather than left for a
 * caller to reassemble. Identity is never colour alone on this document.
 *
 * Set for a glass card: dark type on white, not the plot's light-on-dark.
 */
export function CumulativeCostSummary({ years }: { years: SavingsYear[] }) {
  const { utilityTotal, solarTotal } = useSeries(years);
  if (years.length < 2) return null;
  return (
    <dl className="grid grid-cols-2 gap-4">
      {(
        [
          ["Staying with the utility", utilityTotal, UTILITY_INK],
          ["Going solar", solarTotal, SOLAR_INK],
        ] as [string, number, string][]
      ).map(([label, total, ink]) => (
        <div key={label}>
          <dt className="flex items-center gap-2 text-xs font-medium text-neutral-500">
            <span
              className="size-2.5 shrink-0 rounded-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
              style={{ backgroundColor: ink }}
              aria-hidden
            />
            {label}
          </dt>
          <dd className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-900">
            {usd(total)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

/** How to read the shaded gap. One sentence, and it names both colours. */
export function cumulativeGapNote(paybackYear: number | null): string {
  return `The shaded gap is the difference between the two. It is amber while the system is still paying itself back${
    paybackYear != null ? `, and teal from year ${paybackYear} on` : ""
  }.`;
}
