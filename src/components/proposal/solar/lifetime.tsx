import * as React from "react";
import { cn } from "@/lib/utils";

/**
 * WHERE THE FIGURE IS SITTING.
 *
 * `block` is the original: a dark panel dropped onto the document's cream
 * paper. `card` is the same figure set in dark type for a glass card on a
 * plate, which is where the comparison chapter now states it.
 *
 * One component with two grounds rather than two components, because this
 * number has rules — see `lifetimeFigure` — and the cheapest way to guarantee a
 * loss never wears the accent colour is to have exactly one place that decides
 * what colour it wears.
 */
export type LifetimeSurface = "block" | "card";

/**
 * The one number that nets the system against the bill.
 *
 * Rendered EXACTLY ONCE in the document. It used to appear four times, which is
 * how a figure stops being an argument and starts being wallpaper.
 *
 * Lives in its own file because two chapters can be the one that renders it: it
 * belongs to the comparison, and it moves up to chapter 1 when a rep has turned
 * the comparison off. Importing it from the sheet it usually sits on would have
 * made one chapter depend on another for no reason but where it happened to be
 * written.
 *
 * WHAT `accent` MEANS: good news, and nothing else. A negative lifetime result
 * is a real outcome on plenty of financed deals and it must never wear the
 * colour of a win — see `lifetimeFigure`, which decides the label and the tone
 * together and has a test for it.
 */
export function LifetimeBlock({
  label,
  value,
  note,
  accent,
  aside,
  surface = "block",
}: {
  label: string;
  value: string;
  note: string;
  accent: boolean;
  aside?: React.ReactNode;
  surface?: LifetimeSurface;
}) {
  const card = surface === "card";
  return (
    <div
      data-dark-ground={card ? undefined : ""}
      data-lifetime
      className={cn(
        "overflow-hidden",
        card
          ? "text-neutral-900"
          : [
              "rounded-2xl bg-neutral-950 p-8 text-white sm:p-10",
              "[print-color-adjust:exact] [-webkit-print-color-adjust:exact]",
            ],
      )}
    >
      <div className="flex flex-wrap items-end justify-between gap-x-12 gap-y-8">
        <div className="min-w-[12rem] flex-1">
          <p
            className={cn(
              "text-[11px] font-semibold uppercase tracking-[0.2em]",
              accent
                ? "text-[var(--proposal-accent)]"
                : card
                  ? "text-neutral-500"
                  : "text-neutral-400",
            )}
          >
            {label}
          </p>
          <p
            data-lifetime-figure
            className={cn(
              "mt-2 font-display font-semibold leading-[0.92] tracking-[-0.035em] tabular-nums",
              card
                ? "text-[clamp(2.2rem,4.4vw,3.2rem)] text-neutral-950"
                : "text-[clamp(2.6rem,6vw,4.4rem)] text-white",
            )}
          >
            {value}
          </p>
        </div>
        {aside && <div className="min-w-[11rem]">{aside}</div>}
      </div>
      <p
        className={cn(
          "mt-4 max-w-[54ch] leading-relaxed",
          card ? "text-sm text-neutral-600" : "text-neutral-300",
        )}
      >
        {note}
      </p>
    </div>
  );
}
