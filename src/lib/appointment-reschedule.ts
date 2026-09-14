import type { Vertical } from "@prisma/client";
import type { OutcomeCategory } from "@/lib/dispositions";

/**
 * Whether moving an appointment in this workspace is recorded as a reschedule.
 *
 * Solar only, by the owner's call. Roofing's date saves write exactly what they
 * wrote before this existed: no history row, and never a cleared outcome.
 */
export function tracksReschedules(vertical: Vertical): boolean {
  return vertical === "solar";
}

export type AppointmentReschedule = {
  fromAt: Date;
  toAt: Date;
  /** The outcome the old visit carried. The move clears it from the deal. */
  clearedOutcome: string | null;
};

const MINUTE = 60_000;

/**
 * Decide whether a change to a deal's appointment time is a reschedule.
 *
 * A reschedule moves an EXISTING time to a DIFFERENT one. A first booking and a
 * cleared date are not reschedules, and neither is a save that re-sends the
 * same minute. A visit that already ran is being corrected, not moved, so it
 * keeps its outcome. Any other outcome described the visit that is no longer
 * happening, so it comes off the deal and onto the history row.
 */
export function planAppointmentMove(input: {
  vertical: Vertical;
  prevAt: Date | null;
  nextAt: Date | null;
  outcome: string | null;
  outcomeCategory: OutcomeCategory | null;
}): AppointmentReschedule | null {
  const { prevAt, nextAt, outcome } = input;
  if (!tracksReschedules(input.vertical)) return null;
  if (!prevAt || !nextAt) return null;
  if (Math.floor(prevAt.getTime() / MINUTE) === Math.floor(nextAt.getTime() / MINUTE)) return null;
  if (outcome && input.outcomeCategory === "ran") return null;
  return { fromAt: prevAt, toAt: nextAt, clearedOutcome: outcome };
}
