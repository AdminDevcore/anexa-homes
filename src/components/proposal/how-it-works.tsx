"use client";

import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { SOLAR_HOW_IT_WORKS } from "@/lib/solar-proposal";

/**
 * How solar actually works, for the person reading this alone at ten at night.
 *
 * Half of the households who read a proposal have nobody to ask. They will not
 * ring the rep to say they do not know what an inverter is, and they will not
 * sign something they do not understand — so the document has to be able to
 * explain itself.
 *
 * A carousel rather than five stacked paragraphs, because five paragraphs of
 * explainer between a homeowner and the price is a wall they scroll past. One
 * step at a time is a thing you can finish.
 *
 * ON PAPER IT IS NOT A CAROUSEL. Print gets every step, stacked, because a
 * printed page has no next button and "1 of 5" on paper is a bug.
 */
export function HowItWorks() {
  const steps = SOLAR_HOW_IT_WORKS;
  const [i, setI] = React.useState(0);
  const step = steps[i];

  return (
    <>
      <div className="print:hidden">
        <div className="rounded-3xl bg-white p-7 shadow-sm ring-1 ring-neutral-200/60 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-[var(--proposal-accent)]">
            Step {i + 1} of {steps.length}
          </p>
          {/* aria-live so a screen reader hears the new step rather than
              silently having the page change under it. */}
          <div aria-live="polite">
            <h3 className="mt-3 font-display text-3xl font-bold tracking-tight text-neutral-900 sm:text-4xl">
              {step.title}
            </h3>
            <p className="mt-4 max-w-2xl text-lg leading-relaxed text-neutral-600">{step.blurb}</p>
          </div>

          <div className="mt-9 flex items-center gap-4">
            <button
              type="button"
              onClick={() => setI((n) => Math.max(0, n - 1))}
              disabled={i === 0}
              aria-label="Previous step"
              className="flex size-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-30 disabled:hover:border-neutral-300 disabled:hover:text-neutral-700"
            >
              <ChevronLeft className="size-5" />
            </button>
            <button
              type="button"
              onClick={() => setI((n) => Math.min(steps.length - 1, n + 1))}
              disabled={i === steps.length - 1}
              aria-label="Next step"
              className="flex size-10 items-center justify-center rounded-full border border-neutral-300 text-neutral-700 transition hover:border-neutral-900 hover:text-neutral-900 disabled:opacity-30 disabled:hover:border-neutral-300 disabled:hover:text-neutral-700"
            >
              <ChevronRight className="size-5" />
            </button>

            {/* The steps as dots — and as buttons, because somebody who wants
                step four should not have to click next three times. */}
            <div className="ml-2 flex items-center gap-2">
              {steps.map((s, n) => (
                <button
                  key={s.key}
                  type="button"
                  onClick={() => setI(n)}
                  aria-label={`Step ${n + 1}: ${s.title}`}
                  aria-current={n === i}
                  className={
                    n === i
                      ? "h-2 w-8 rounded-full bg-neutral-900 transition-all"
                      : "size-2 rounded-full bg-neutral-300 transition-all hover:bg-neutral-400"
                  }
                />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Paper. Every step, in order, no controls. */}
      <ol className="hidden print:block">
        {steps.map((s, n) => (
          <li key={s.key} className="break-inside-avoid border-t border-neutral-200 py-3 first:border-t-0">
            <p className="font-semibold text-neutral-900">
              {n + 1}. {s.title}
            </p>
            <p className="mt-0.5 text-sm leading-relaxed text-neutral-600">{s.blurb}</p>
          </li>
        ))}
      </ol>
    </>
  );
}
