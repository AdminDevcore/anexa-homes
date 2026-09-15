import type { Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { outcomeCategory } from "@/lib/dispositions";
import {
  planAppointmentMove,
  tracksReschedules,
  type AppointmentReschedule,
} from "@/lib/appointment-reschedule";

/**
 * The server half of reschedule tracking.
 *
 * Every path that moves an existing deal's appointment time goes through here:
 * the full edit form, the deal's Summary card, a Field Map booking, the
 * calendar's Reschedule button. A reschedule count with holes in it is one
 * nobody can use.
 *
 * NOT a "use server" module, on purpose. Its callers have already decided the
 * user may touch this deal; exporting these as RPC endpoints would hand that
 * decision to the browser.
 */

type LeadForMove = {
  vertical: Vertical;
  appointmentAt: Date | null;
  appointmentDisposition: string | null;
};

/**
 * Plan the move BEFORE the caller's update, so a cleared outcome rides in the
 * same write as the new time. Null when there is nothing to record.
 */
export async function planLeadAppointmentMove(
  companyId: string,
  lead: LeadForMove,
  nextAt: Date | null
): Promise<AppointmentReschedule | null> {
  // Cheap exits first: roofing never tracks, and most saves don't move the
  // time. Neither should cost a settings read.
  if (!tracksReschedules(lead.vertical) || !lead.appointmentAt || !nextAt) return null;
  const category = lead.appointmentDisposition
    ? outcomeCategory(lead.appointmentDisposition, await getAppointmentDispositions(companyId, lead.vertical))
    : null;
  return planAppointmentMove({
    vertical: lead.vertical,
    prevAt: lead.appointmentAt,
    nextAt,
    outcome: lead.appointmentDisposition,
    outcomeCategory: category,
  });
}

/** What a planned move adds to the caller's lead update. */
export function appointmentMovePatch(move: AppointmentReschedule | null): { appointmentDisposition?: null } {
  return move?.clearedOutcome ? { appointmentDisposition: null } : {};
}

/**
 * Write the history row AFTER the deal's update has landed.
 *
 * Non-throwing, like recordStageEntry: the rep's save has already succeeded,
 * and reporting it as failed (so they retry) would do more harm than a
 * missing row.
 */
export async function recordAppointmentReschedule(
  leadId: string,
  move: AppointmentReschedule | null,
  movedById: string | null
): Promise<void> {
  if (!move) return;
  try {
    await prisma.leadAppointmentReschedule.create({
      data: {
        leadId,
        fromAt: move.fromAt,
        toAt: move.toAt,
        clearedOutcome: move.clearedOutcome,
        movedById,
      },
    });
  } catch (err) {
    console.error("[appointment-moves] failed to record reschedule", { leadId, err });
  }
}
