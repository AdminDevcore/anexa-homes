"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { Chapter } from "../primitives";
import { SOLAR_TIMELINE } from "@/lib/solar-proposal";
import type { Doc } from "./doc";

/**
 * 07 · THE PLAN.
 *
 * Six steps and who owns each. The content is unchanged — it was already the
 * most honest page in the document, with a RANGE on every duration and the city
 * and the utility named as the people who actually hold the slow parts.
 *
 * What changed is that it gets the sheet to itself. The four environmental
 * equivalences and the home-value note used to be bolted underneath, which
 * pushed the chapter onto a second page where three steps and a paragraph
 * arrived with no chapter mark on them. They are back matter now: an EPA
 * equivalence is worth stating and is not worth interrupting the page that
 * answers "so what do I actually have to do?"
 *
 * The rail carries the title, so the steps get a real timeline rather than the
 * three-column reflow the print stylesheet used to force on them.
 */
export function ChapterNext({ doc }: { doc: Doc }) {
  return (
    <Chapter
      id="timeline"
      index={doc.num("timeline")}
      total={doc.total}
      eyebrow="The plan"
      title="What happens next"
      lede={
        <>
          Six steps, with a range on each rather than a promise. No dates are scheduled yet — your
          site survey is booked once you go ahead.
        </>
      }
    >
      <ol className="relative">
        <span
          className="pointer-events-none absolute bottom-6 left-[15px] top-6 w-px bg-neutral-900/15"
          aria-hidden
        />
        {SOLAR_TIMELINE.map((step, i) => (
          <li
            key={step.key}
            data-stagger
            style={{ ["--i" as string]: i } as React.CSSProperties}
            className="relative flex items-start gap-5 py-3"
          >
            <span className="relative z-10 mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-full bg-[var(--proposal-accent)] font-display text-sm font-semibold text-white ring-4 ring-[#f6f3ee] [print-color-adjust:exact] [-webkit-print-color-adjust:exact]">
              {i + 1}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-0.5">
                <p className="font-medium text-neutral-900">{step.title}</p>
                {/* A RANGE, always. "2 weeks" on a permit that regularly takes
                    five is the promise the customer remembers, and the one the
                    install date gets measured against. */}
                <p className="text-sm font-medium tabular-nums text-neutral-500">{step.duration}</p>
              </div>
              <p className="mt-0.5 max-w-[62ch] text-sm leading-relaxed text-neutral-600">
                {step.blurb}
              </p>
              {/* Who actually does it. "We handle everything" is the sentence
                  every solar company says; naming the city and the utility is
                  both more convincing and true on the day one of them is
                  slow. */}
              <ul className="mt-1.5 flex flex-wrap gap-1.5">
                {step.owners.map((owner) => (
                  <li
                    key={owner}
                    className={cn(
                      "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                      owner === "You"
                        ? "bg-[var(--proposal-accent)]/12 text-[var(--proposal-accent)]"
                        : "bg-neutral-900/[0.06] text-neutral-600",
                    )}
                  >
                    {owner}
                  </li>
                ))}
              </ul>
            </div>
          </li>
        ))}
      </ol>
    </Chapter>
  );
}
