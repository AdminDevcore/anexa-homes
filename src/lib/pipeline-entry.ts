/**
 * WHERE A NEW DEAL ENTERS THE PIPELINE.
 *
 * Booking an appointment and creating a deal are the same act, so the entry
 * stage is never a decision anybody makes — it is read off the appointment
 * date:
 *
 *   • no date  → the pipeline's FIRST stage ("New Appointment")
 *   • has date → "Appointment Set", on a pipeline that defines one (roofing;
 *                solar has no such stage and keeps everything at the front)
 *
 * Pure, and free of any database import, so the intake form can show the rep
 * exactly the stage the server is about to derive instead of offering them a
 * picker for a choice that has already been made. `resolveStageForAppointment`
 * (server) applies this same rule to a lead that already exists.
 */

/** The stage key that means "booked, not yet run". Roofing pipelines only. */
export const APPOINTMENT_SET_KEY = "appointment_set";

export type EntryStageShape = { id: string; key: string };

/**
 * The front-of-pipeline stage a deal with (or without) an appointment belongs
 * in. `stages` must be in pipeline order; null when the pipeline has no stages.
 */
export function entryStage<T extends EntryStageShape>(
  stages: T[],
  hasAppointment: boolean,
): T | null {
  if (stages.length === 0) return null;
  const apptSet = stages.find((s) => s.key === APPOINTMENT_SET_KEY);
  return hasAppointment && apptSet ? apptSet : stages[0];
}
