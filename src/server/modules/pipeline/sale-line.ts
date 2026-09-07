import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { findSaleLine, soldStageIds, type SaleStageShape } from "@/lib/sold-stage";

/**
 * The company's sale line, read from its pipelines — see lib/sold-stage.ts for
 * the rule and why `Lead.status` cannot be used for this.
 *
 * `stageIds` is what a query filters on: every stage, in every pipeline asked
 * for, that means the deal in it has been sold. `label` is what the screen tells
 * the user the number means, so a leaderboard reading zero can be traced to the
 * stage that decided it rather than looking broken.
 */
export type SaleLine = {
  stageIds: Set<string>;
  /** The stage the sale is booked at, for the caption. Null = nothing marks one. */
  label: string | null;
};

const STAGE_SELECT = {
  id: true,
  name: true,
  position: true,
  countsAsSold: true,
  isWon: true,
  isLost: true,
} as const;

/**
 * Pass the vertical the caller is reporting on. It is redundant with the
 * isolation extension by design: the dashboard already knows which workspace it
 * is drawing, and a missing ALS context must not silently widen the answer to
 * both pipelines.
 */
export async function getSaleLine(companyId: string, vertical?: Vertical): Promise<SaleLine> {
  const pipelines = await prisma.pipeline.findMany({
    where: { companyId, ...(vertical ? { vertical } : {}) },
    select: { stages: { select: STAGE_SELECT } },
  });

  const label = labelFor(pipelines.map((p) => p.stages));
  return { stageIds: soldStageIds(pipelines), label };
}

/**
 * What to call the line across however many pipelines were asked for. One
 * pipeline names it; several that agree still name it once; several that
 * disagree name none, because there is no single honest answer to print.
 */
function labelFor(pipelines: SaleStageShape[][]): string | null {
  const names = new Set<string>();
  for (const stages of pipelines) {
    const line = findSaleLine(stages);
    if (line) names.add(line.name);
  }
  return names.size === 1 ? [...names][0] : null;
}

/**
 * The `where` fragment that means "this deal is won", ready to spread into any
 * Lead query.
 *
 * Every won count in the product used to read `status: "won"`, an enum value
 * only the demo seed has ever written — so they all reported zero. Spreading
 * this instead keeps one definition of won across the dashboard and every
 * report, and keeps it under the company's own control.
 *
 * An empty stage set yields `{ stageId: { in: [] } }`, which matches nothing.
 * That is the honest answer for a pipeline that marks no sale stage at all.
 */
export async function wonLeadFilter(
  companyId: string,
  vertical?: Vertical,
): Promise<{ stageId: { in: string[] } }> {
  const { stageIds } = await getSaleLine(companyId, vertical);
  return { stageId: { in: [...stageIds] } };
}
