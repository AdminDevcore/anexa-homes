"use client";

import * as React from "react";
import { Chapter, SpecList } from "../primitives";
import { EscalatorCurve } from "../escalator";
import { LifetimeBlock } from "../lifetime";
import { lifetimeNote } from "@/lib/solar-proposal-pitch";
import { usd, kwh, pct } from "../../format";
import type { Doc } from "./doc";

/**
 * 01 · WHERE YOU ARE NOW.
 *
 * The chapter used to open with `BillSwap` — the same two bars, the same two
 * numbers, that the cover had drawn one screen earlier at twice the size. A
 * document whose second sheet repeats its first has told the reader that
 * turning the page is optional.
 *
 * So the cover keeps the swap, and this draws what the cover cannot: the bill
 * compounding. Every figure later in the document rests on the escalation
 * assumption and the only place a homeowner used to meet it was a table row
 * saying "Rising by 3.5% a year" — a number that is easy to nod at and
 * impossible to feel.
 */
export function ChapterToday({
  doc,
  showComparison,
}: {
  doc: Doc;
  /**
   * When the comparison chapter is turned off, the lifetime figure moves here
   * rather than disappearing. The document must not lose the one number that
   * nets the system against the bill along with a table a rep chose to skip.
   */
  showComparison: boolean;
}) {
  const { s, sv, lifetime, f } = doc;
  const utility = s.energy.utilityProvider ?? "your utility";

  return (
    <Chapter
      id="today"
      index={doc.num("today")}
      total={doc.total}
      eyebrow="Where you are now"
      title="The bill is not flat"
      lede={
        <>
          Today every kilowatt-hour your home uses is bought from {utility} at a rate they set,
          and that rate has one direction. This is what standing still costs.
        </>
      }
    >
      <EscalatorCurve years={sv.years} />

      <div className="mt-10">
        <SpecList
          items={[
            ["Utility", s.energy.utilityProvider],
            ["Rate plan", s.energy.ratePlan],
            ["Annual usage", s.energy.annualUsageKwh > 0 ? kwh(s.energy.annualUsageKwh) : null],
            [
              "Estimated annual cost",
              s.energy.currentAnnualCostCents != null ? usd(s.energy.currentAnnualCostCents) : null,
            ],
            [
              "Your current rate",
              s.assumptions.currentRateMillsPerKwh > 0
                ? `$${(s.assumptions.currentRateMillsPerKwh / 1000).toFixed(3)} per kWh`
                : null,
            ],
            ["Rising by", pct(s.assumptions.utilityEscalationPct) + " a year"],
          ]}
        />
        <p className="mt-4 text-sm text-neutral-500">
          Your rate is worked out from your own bill and usage — not a regional average.
        </p>
      </div>

      {!showComparison && (
        <div className="mt-10">
          <LifetimeBlock
            label={lifetime.label}
            value={usd(lifetime.cents)}
            note={lifetimeNote(lifetime, s.energy.utilityProvider, !!f.ownershipNote)}
            accent={lifetime.tone === "good"}
          />
        </div>
      )}
    </Chapter>
  );
}
