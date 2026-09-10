import type { Prisma } from "@prisma/client";

/**
 * Deals that are still alive — i.e. NOT sitting in a stage their pipeline flags
 * `isLost`.
 *
 * ## Why the stage flag and not `Lead.status`
 *
 * Two paths kill a deal and they do not agree. `cancelLeadAction` moves it to
 * the lost stage AND writes `status: "lost"`. Dragging the card into the
 * Cancelled column on the Pipeline board goes through `moveLeadStage`, which
 * touches the stage and deliberately leaves `status` alone — inferring "this is
 * dead" from a drag is how a live deal would quietly leave revenue totals.
 *
 * So `status` is true down one path and the stage flag is true down both. The
 * stage flag is also exactly what the red "Cancelled" chip in the UI already
 * renders, which means what a user sees and what this hides can never disagree.
 *
 * ## Why an explicit OR
 *
 * Written as `OR: [stageId null, stage.isLost false]` rather than
 * `NOT: { stage: { is: … } }` so that a lead with no stage at all — brand new,
 * or on a company with no pipeline — is unambiguously alive, rather than
 * depending on how a negated nullable relation resolves.
 *
 * ## Where this is NOT applied
 *
 * The Pipeline board (its Cancelled column is the point of that column) and
 * every report. Hiding a dead deal from a work list is a presentation choice;
 * hiding it from the numbers would be a lie about what happened.
 */
export const NOT_CANCELLED = {
  OR: [{ stageId: null }, { stage: { is: { isLost: false } } }],
} satisfies Prisma.LeadWhereInput;
