import type { SavingsYear } from "@/lib/solar-proposal";
import { usd } from "../format";

/**
 * WHAT STANDING STILL COSTS.
 *
 * The chapter that opens the document used to draw the bill swap — the same
 * two bars the cover had already drawn one screen earlier, at a larger size,
 * with the same two numbers in them. Repeating the cover's own figure as the
 * first thing behind it is how a document teaches a reader that turning the
 * page is optional.
 *
 * This draws the argument the document had never made anywhere: the utility
 * bill is not a flat line. Every figure further on rests on the escalation
 * assumption, and until now the only place a homeowner met it was a table row
 * reading "Rising by 3.5% a year" — a number that is easy to nod at and
 * impossible to feel. Compounded across the horizon and drawn, it is the reason
 * to act rather than to think about it next year.
 *
 * Straight off `savings.years[].utilityCostCents`, so it is the SAME series the
 * comparison chapter later plots against solar. Nothing is modelled here.
 *
 * A server component: a static SVG with nothing to interact with, on a document
 * that prints.
 */
export function EscalatorCurve({ years }: { years: SavingsYear[] }) {
  if (years.length < 2) return null;

  const costs = years.map((y) => y.utilityCostCents);
  const peak = Math.max(...costs);
  if (peak <= 0) return null;

  const first = costs[0];
  const last = costs[costs.length - 1];
  const lastYear = years[years.length - 1].year;

  const W = 640;
  const H = 200;
  const PAD_B = 8;
  // Headroom so the final point is not welded to the top edge.
  const scale = peak * 1.06;

  const x = (i: number) => (i / (years.length - 1)) * W;
  const y = (c: number) => H - PAD_B - (c / scale) * (H - PAD_B);

  const line = costs.map((c, i) => `${i === 0 ? "M" : "L"}${x(i).toFixed(1)} ${y(c).toFixed(1)}`).join(" ");
  const area = `${line} L${W} ${H - PAD_B} L0 ${H - PAD_B} Z`;

  /** The multiple, stated in words under the drawing. */
  const multiple = first > 0 ? last / first : 0;

  return (
    <figure className="mt-2">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
        role="img"
        aria-label={`What a year of grid power is projected to cost, rising from ${usd(first)} in year one to ${usd(last)} in year ${lastYear}.`}
      >
        {/* Recessive grid — halves of the range, nothing more. The drawing is
            about a SHAPE, and a ruled background invites reading values off it
            that the two labelled endpoints already state exactly. */}
        {[0.5, 1].map((t) => (
          <line
            key={t}
            x1={0}
            x2={W}
            y1={y(scale * t)}
            y2={y(scale * t)}
            stroke="#e2ddd4"
            strokeWidth={1}
          />
        ))}

        <path d={area} fill="var(--proposal-accent)" fillOpacity={0.13} />
        <path
          d={line}
          fill="none"
          stroke="var(--proposal-accent)"
          strokeWidth={2}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <line x1={0} x2={W} y1={y(0)} y2={y(0)} stroke="#d6d0c6" strokeWidth={1} />

        {/* Both ends marked, because both ends are labelled beneath. */}
        <circle cx={x(0)} cy={y(first)} r={4} fill="var(--proposal-accent)" stroke="#f6f3ee" strokeWidth={2} />
        <circle
          cx={x(years.length - 1)}
          cy={y(last)}
          r={5}
          fill="var(--proposal-accent)"
          stroke="#f6f3ee"
          strokeWidth={2}
        />
      </svg>

      {/* The two endpoints, direct-labelled rather than left to the axis. A
          single series needs no legend — the caption names it. */}
      <figcaption className="mt-4 flex items-baseline justify-between gap-6 border-t border-neutral-900/12 pt-4">
        <span>
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            Year one
          </span>
          <span className="mt-1 block font-display text-xl font-semibold tabular-nums text-neutral-900">
            {usd(first)}
          </span>
        </span>
        <span className="text-right">
          <span className="block text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-400">
            Year {lastYear}
          </span>
          <span className="mt-1 block font-display text-xl font-semibold tabular-nums text-neutral-900">
            {usd(last)}
          </span>
        </span>
      </figcaption>

      <p className="mt-3 text-sm leading-relaxed text-neutral-500">
        {multiple >= 1.15
          ? `A year of grid power is projected to cost ${multiple.toFixed(1)} times what it costs today by year ${lastYear}. Nothing about that curve depends on this proposal — it is what the bill does on its own.`
          : `Projected on your utility's own rate and the escalation assumed below. Nothing about that curve depends on this proposal — it is what the bill does on its own.`}
      </p>
    </figure>
  );
}
