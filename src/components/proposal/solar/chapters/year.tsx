"use client";

import * as React from "react";
import { Chapter } from "../primitives";
import { YearChart } from "../../year-chart";
import type { Doc } from "./doc";

/**
 * 03 · MONTH BY MONTH.
 *
 * The figure the document has always had the data for and never gave a page to.
 * `snapshot.monthly` holds twelve months of MEASURED usage against twelve
 * months of simulated production, and it is populated only when both halves are
 * real — see the field's own note for why a modelled curve drawn beside an
 * annual total spread evenly is a picture nobody can tell apart from a
 * measurement.
 *
 * Until now it rendered as a subsection three-quarters of the way down the
 * opening chapter, under the escalator and the specification list, where a
 * reader on paper met it as the top of a continuation sheet with no chapter
 * mark on it.
 *
 * It earns a page because it answers the question a homeowner asks about solar
 * that an annual offset percentage cannot: *what about December?* A system at
 * 84% does not cover 84% of every month — it overshoots in June and falls short
 * in January, and the credit built in summer is what pays for winter. Saying so
 * before they ask is the difference between a proposal and a sales document.
 *
 * OMITTED ENTIRELY when `monthly` is null, which is every document generated
 * before the field existed. The chapter is not in the list, so the numbering
 * closes over the gap.
 */
export function ChapterYear({ doc }: { doc: Doc }) {
  const { s } = doc;
  if (!s.monthly) return null;

  return (
    <Chapter
      id="year"
      index={doc.num("year")}
      total={doc.total}
      eyebrow="Month by month"
      title="Summer carries winter"
      lede={
        <>
          An annual figure hides the two things that actually decide your bill: summer makes more
          than you use, and winter makes less.
        </>
      }
    >
      <YearChart productionKwh={s.monthly.productionKwh} usageKwh={s.monthly.usageKwh} />
    </Chapter>
  );
}
