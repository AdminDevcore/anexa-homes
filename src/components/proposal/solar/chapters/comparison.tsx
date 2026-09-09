"use client";

import * as React from "react";
import { Plate, GlassCard } from "../primitives";
import { CumulativeCostPlot, CumulativeCostSummary, cumulativeGapNote } from "../chart";
import { LifetimeBlock } from "../lifetime";
import { lifetimeNote } from "@/lib/solar-proposal-pitch";
import { usd, yearsInWords } from "../../format";
import type { Doc } from "./doc";

/**
 * 05 · THE MATHS — the chart IS the page.
 *
 * This chapter used to be the document's worst offender and its best argument
 * at the same time. It carried two comparison cards, then the chart in a white
 * box, then the lifetime figure, then the battery programme, then an
 * assumptions paragraph, then a scrubber, then a year table, then four
 * footnotes — three sheets, two of them orphans with no chapter mark, and the
 * trio of totals printed twice because the cards and the lifetime block each
 * quoted them.
 *
 * Now the drawing runs edge to edge and everything else moves. The two totals
 * are stated ONCE, in the card, beside the net figure they make. The year
 * table, the assumptions, the programme and the scrubber are back matter — they
 * are the evidence, and the evidence stops competing with the argument for the
 * same sheet.
 *
 * `CompareCards` is gone. What it said is the two lines and the two totals, and
 * both are here.
 */
export function ChapterComparison({ doc }: { doc: Doc }) {
  const { s, sv, lifetime } = doc;

  return (
    <Plate
      id="savings"
      index={doc.num("savings")}
      total={doc.total}
      eyebrow="The maths"
      title={
        <>
          {yearsInWords(sv.years.length)} years,
          <br />
          both ways.
        </>
      }
      lede={
        <>
          What the same {sv.years.length} years cost if you stay with{" "}
          {s.energy.utilityProvider ?? "your utility"}, and what they cost if you go ahead. The gap
          between the lines is the whole point.
        </>
      }
      /* A drawing, not a photograph: the same wash that makes white type land
         on a bright roof would flatten the two lines this sheet exists for. */
      veil="soft"
      background={
        /* The drawing sits BELOW the card, not behind it.

           ABSOLUTE, not padding. A percentage `padding-top` resolves against
           the containing block's WIDTH, so `pt-[64%]` on a landscape sheet came
           out as 601px of an 816px page and squeezed the plot to a sliver.
           `top` and `bottom` percentages resolve against HEIGHT, which is the
           axis this is actually positioning against.

           Below the card rather than behind it because the panel was covering
           the right-hand third of the plot — precisely where the two lines
           diverge and where the end markers are, so it was hiding the part of
           the chart this chapter exists to show. */
        <div className="absolute inset-x-10 bottom-[14%] top-[56%] hidden @[52rem]:block @[52rem]:inset-x-14 @[52rem]:top-[62%]">
          <CumulativeCostPlot years={sv.years} paybackYear={sv.paybackYear} />
        </div>
      }
      card={
        <GlassCard className="w-full px-6 py-6 sm:px-7 sm:py-7">
          <LifetimeBlock
            surface="card"
            label={lifetime.label}
            value={usd(lifetime.cents)}
            note={lifetimeNote(lifetime, s.energy.utilityProvider)}
            accent={lifetime.tone === "good"}
          />
          <div className="mt-5 border-t border-neutral-900/12 pt-5">
            <CumulativeCostSummary years={sv.years} />
          </div>
          <div className="mt-5 border-t border-neutral-900/12 pt-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-neutral-500">
              Utility bill avoided
            </p>
            <p className="mt-1 font-display text-xl font-semibold tabular-nums text-neutral-950">
              {usd(sv.utilityCostAvoidedCents)}
            </p>
            <p className="mt-0.5 text-xs text-neutral-500">before paying for the system</p>
          </div>
        </GlassCard>
      }
      caption={
        <>
          {cumulativeGapNote(sv.paybackYear)} Assumes your utility rate rises{" "}
          {s.assumptions.utilityEscalationPct}% a year and your panels lose{" "}
          {s.assumptions.annualDegradationPct}% output annually. Both are estimates, not
          guarantees — the year-by-year figures and every assumption are set out at the end of this
          document.
        </>
      }
    >
      {/* NARROW: the plot is not a background.

          On a phone the head and the card stack down the whole sheet, so a
          drawing pinned behind them is a drawing nobody sees — it sat under the
          card with only its corners showing. Here it is an ordinary block
          underneath the card, which is where a reader scrolling actually
          arrives at it. Rendered twice and hidden once rather than moved,
          because the wide sheet genuinely wants it as a full-bleed ground and
          the narrow one genuinely wants it in the flow. */}
      <div className="h-56 @[52rem]:hidden">
        <CumulativeCostPlot years={sv.years} paybackYear={sv.paybackYear} />
      </div>
    </Plate>
  );
}
