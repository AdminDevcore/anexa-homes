import { cn } from "@/lib/utils";
import { kwh, MONTH_LABELS } from "./format";

/**
 * The customer's year: what the house uses each month against what the roof
 * makes each month.
 *
 * This is the chart that explains the two things an annual offset figure hides.
 * A system at 100% offset does not cover 100% of every month — it overshoots in
 * June and falls short in January, and the credit built up in summer is what
 * pays for winter. A homeowner who has not seen those two curves is surprised
 * by their first December bill.
 *
 * RENDERED ONLY WHEN BOTH SERIES ARE REAL. See the snapshot's `monthly` field:
 * twelve simulated months drawn against an annual total spread evenly is a
 * picture of an assumption, and nobody can tell it apart from a picture of a
 * measurement by looking at it.
 *
 * A server component: it is a static SVG, there is nothing to interact with,
 * and the whole document prints.
 */
export function YearChart({
  productionKwh,
  usageKwh,
  className,
}: {
  productionKwh: number[];
  usageKwh: number[];
  className?: string;
}) {
  if (productionKwh.length !== 12 || usageKwh.length !== 12) return null;

  const peak = Math.max(...productionKwh, ...usageKwh);
  if (peak <= 0) return null;

  // A little headroom so the tallest bar is not flush with the frame.
  const scale = peak * 1.08;
  const W = 760;
  const H = 260;
  const PAD_L = 6;
  const PAD_B = 26;
  const plotH = H - PAD_B;
  const slot = (W - PAD_L * 2) / 12;
  const barW = slot * 0.5;

  const y = (v: number) => plotH - (v / scale) * plotH;
  const cx = (i: number) => PAD_L + slot * i + slot / 2;

  const line = productionKwh.map((v, i) => `${cx(i)},${y(v)}`).join(" ");
  const area = `${PAD_L},${plotH} ${line} ${W - PAD_L},${plotH}`;

  const totalUse = usageKwh.reduce((n, v) => n + v, 0);
  const totalMake = productionKwh.reduce((n, v) => n + v, 0);
  const covered = productionKwh.filter((v, i) => v >= usageKwh[i]).length;

  return (
    <figure className={cn("mt-8", className)}>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full [print-color-adjust:exact] [-webkit-print-color-adjust:exact]"
        role="img"
        aria-label={`Monthly electricity use against monthly solar production. The house uses ${kwh(totalUse)} a year; the system is projected to make ${kwh(totalMake)}.`}
      >
        {/* Quarter gridlines. Faint enough to read as paper rather than as data. */}
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <line
            key={f}
            x1={PAD_L}
            x2={W - PAD_L}
            y1={y(scale * f)}
            y2={y(scale * f)}
            stroke="currentColor"
            className="text-neutral-200"
            strokeWidth={1}
            strokeDasharray="3 5"
          />
        ))}

        {/* What the house uses — bars, because a month's consumption is a
            quantity that happened, not a trend. */}
        {usageKwh.map((v, i) => (
          <rect
            key={`u-${i}`}
            x={cx(i) - barW / 2}
            y={y(v)}
            width={barW}
            height={Math.max(1, plotH - y(v))}
            rx={3}
            className="fill-neutral-300"
          />
        ))}

        {/* What the roof makes — a curve over the top, because production is a
            season and reads as one. */}
        <polygon points={area} className="fill-[var(--proposal-accent)]" opacity={0.14} />
        <polyline
          points={line}
          fill="none"
          stroke="var(--proposal-accent)"
          strokeWidth={2.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {productionKwh.map((v, i) => (
          <circle key={`p-${i}`} cx={cx(i)} cy={y(v)} r={3} className="fill-[var(--proposal-accent)]" />
        ))}

        {MONTH_LABELS.map((m, i) => (
          <text
            key={m}
            x={cx(i)}
            y={H - 8}
            textAnchor="middle"
            className="fill-neutral-400 text-[11px]"
          >
            {m}
          </text>
        ))}
      </svg>

      <figcaption className="mt-4 flex flex-wrap items-center gap-x-6 gap-y-2 text-sm text-neutral-500">
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-neutral-300" aria-hidden />
          What your home uses
        </span>
        <span className="flex items-center gap-2">
          <span className="size-3 rounded-sm bg-[var(--proposal-accent)]" aria-hidden />
          What the system makes
        </span>
      </figcaption>

      <p className="mt-3 max-w-2xl text-sm leading-relaxed text-neutral-500">
        {covered === 12
          ? "The system is projected to cover every month of the year on its own."
          : covered === 0
            ? "The system is projected to reduce every month's bill rather than eliminate any of them — you stay on the grid year round."
            : `The system is projected to cover ${covered} ${covered === 1 ? "month" : "months"} outright. In the rest you buy the difference, and in the summer months the surplus is credited back under your utility's programme.`}
      </p>
    </figure>
  );
}
