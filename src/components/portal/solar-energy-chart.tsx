import { cn } from "@/lib/utils";

/**
 * What the house uses against what the roof makes.
 *
 * Two facts and the ratio between them, which is the whole conversation on a
 * doorstep — and the Energy step had neither of them on screen, only the boxes
 * they were typed into. A rep could enter 14,000 kWh, draw an array, and never
 * see the two numbers next to each other until the proposal was generated.
 *
 * DELIBERATELY NOT twelve monthly columns. We hold one annual figure and one
 * annual yield; splitting either across the months would need a seasonal shape
 * nobody has measured for this house, and a modelled curve drawn beside a
 * measured total reads as though both were measured. When monthly readings are
 * actually collected, this is where they go.
 *
 * Both bars share ONE scale — the larger of the two — so their lengths are
 * comparable by eye. Each is labelled with its own figure, so identity never
 * rests on colour alone and the chart survives being printed in grey.
 *
 * Colours are the two-hue categorical pair validated for this surface in both
 * light and dark mode (OKLCH lightness band, chroma floor, CVD separation,
 * contrast). They are written out rather than taken from the theme's chart
 * tokens because those are a greyscale ramp — fine for a sequential magnitude,
 * useless for telling two categories apart.
 */
export function SolarEnergyChart({
  annualUsageKwh,
  year1ProductionKwh,
  className,
}: {
  annualUsageKwh: number | null;
  year1ProductionKwh: number;
  className?: string;
}) {
  const usage = annualUsageKwh && annualUsageKwh > 0 ? annualUsageKwh : null;
  const production = year1ProductionKwh > 0 ? year1ProductionKwh : null;

  if (!usage && !production) {
    return (
      <p className={cn("text-xs text-muted-foreground", className)}>
        Record what the house uses, and draw the array, and the two appear here side by side.
      </p>
    );
  }

  const scale = Math.max(usage ?? 0, production ?? 0);
  const pct = (v: number | null) => (scale > 0 && v ? Math.max(2, (v / scale) * 100) : 0);
  const offset = usage && production ? (production / usage) * 100 : null;

  return (
    <figure className={cn("space-y-3 rounded-lg border border-border bg-muted/30 p-4", className)}>
      <figcaption className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        A year of power
      </figcaption>

      <div className="space-y-2.5">
        <Bar
          label="The house uses"
          value={usage}
          pct={pct(usage)}
          empty="no usage recorded yet"
          className="bg-[#d97706] dark:bg-[#bf7d09]"
        />
        <Bar
          label="The array makes"
          value={production}
          pct={pct(production)}
          empty="nothing drawn on the roof yet"
          className="bg-[#0284c7] dark:bg-[#1898d8]"
        />
      </div>

      {offset != null && (
        <p className="text-sm">
          <span
            data-testid="energy-chart-offset"
            className="font-display text-2xl font-semibold tabular-nums"
          >
            {offset.toFixed(0)}%
          </span>{" "}
          <span className="text-muted-foreground">
            of their year covered
            {offset >= 100
              ? " — the array makes more than the house uses"
              : ` · ${(usage! - production!).toLocaleString()} kWh still bought from the utility`}
          </span>
        </p>
      )}
    </figure>
  );
}

/**
 * One bar, its name and its figure.
 *
 * The value sits at the end of the row rather than inside the fill: a label
 * inside a short bar either overflows it or is clipped by it, and the shortest
 * bar is the one whose number is most worth reading.
 */
function Bar({
  label,
  value,
  pct,
  empty,
  className,
}: {
  label: string;
  value: number | null;
  pct: number;
  empty: string;
  className: string;
}) {
  return (
    <div className="flex items-center gap-3 text-sm">
      <span className="w-28 shrink-0 text-muted-foreground">{label}</span>
      <div className="h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-border/60">
        {value != null && (
          <div
            className={cn("h-full rounded-full", className)}
            style={{ width: `${pct}%` }}
            role="presentation"
          />
        )}
      </div>
      <span className="w-32 shrink-0 text-right tabular-nums">
        {value == null ? (
          <span className="text-xs text-muted-foreground">{empty}</span>
        ) : (
          <>
            {value.toLocaleString()} <span className="text-muted-foreground">kWh</span>
          </>
        )}
      </span>
    </div>
  );
}
