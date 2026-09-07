import { isSaleStage } from "./stage-history";

/**
 * WHERE A DEAL COUNTS AS SOLD.
 *
 * The team leaderboard's "Won" column, and every close rate built on it, needs
 * to know the moment the customer said yes. `Lead.status` cannot answer it: the
 * enum has a `won` value that NOTHING in the app has ever written — only the
 * demo seed sets it — so every won count in the product read zero for as long
 * as it has existed.
 *
 * The stage answers it instead, which is also where the person running the
 * company expects to control it. Three rules, in order:
 *
 *   1. The stage flagged "Counts as sold" in Settings → Pipeline. Per pipeline,
 *      so Roofing and Solar each book the sale at their own moment.
 *   2. Failing that, the stage NAMED for the signature — "Contract Signed" in
 *      both shipped pipelines. This is what makes the number right on the day
 *      this ships, before anybody has opened Settings.
 *   3. Failing that, the pipeline's won stage, so a custom pipeline still
 *      reports something rather than reporting that nobody has ever sold.
 *
 * Deliberately NOT `isWon`. That flag sits on Paid / System Activated — the end
 * of the JOB — and the backlog and cycle-time reports read it there. A company
 * sells in month one and gets paid in month four; one flag cannot mark both
 * without lying to one of them.
 *
 * Free of any database import so the rule can be unit-tested on its own, the
 * same way the commission gate is.
 */

export type SaleStageShape = {
  id: string;
  name: string;
  position: number;
  countsAsSold: boolean;
  isWon: boolean;
  isLost: boolean;
};

/**
 * The stage one pipeline books its sale at, or null when it marks nothing.
 * Earliest position wins: two flagged stages means the first one is the moment
 * the deal became a sale and the second is somewhere it went afterwards.
 */
export function findSaleLine<T extends SaleStageShape>(stages: T[]): T | null {
  const byPosition = [...stages].sort((a, b) => a.position - b.position);
  return (
    byPosition.find((s) => s.countsAsSold && !s.isLost) ??
    byPosition.find((s) => isSaleStage(s) && !s.isLost) ??
    byPosition.find((s) => s.isWon && !s.isLost) ??
    null
  );
}

/**
 * Every stage id, across the pipelines given, that means the deal sitting in it
 * has been sold.
 *
 * AT OR PAST THE LINE, BY POSITION — not an exact match. A deal that signed and
 * has since moved on to production, inspection or payment is still a sale, and
 * a leaderboard that only counted deals frozen on the signature stage would
 * count almost nothing.
 *
 * NEVER A LOST STAGE. Cancelled lives at the very end of both pipelines, so
 * "at or past" sweeps it up; a dead deal counting as a win is the one error
 * nobody spots by eye.
 */
export function soldStageIds(pipelines: { stages: SaleStageShape[] }[]): Set<string> {
  const sold = new Set<string>();
  for (const p of pipelines) {
    const line = findSaleLine(p.stages);
    if (!line) continue;
    for (const s of p.stages) {
      if (s.isLost) continue;
      if (s.position >= line.position) sold.add(s.id);
    }
  }
  return sold;
}
