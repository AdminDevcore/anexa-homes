import { prisma } from "@/server/db/client";
import { zonedWallClockToUtc } from "@/lib/tz";
import { updateLeadPatchAction } from "@/server/modules/leads/manage";
import { setAppointmentDispositionAction } from "@/server/modules/leads/actions";
import { resolveStageForAppointment } from "@/server/modules/leads/staging";
import { planLeadAppointmentMove } from "@/server/modules/leads/appointment-moves";
import { getAppointmentDispositions } from "@/server/modules/settings/queries";
import { refuseUnless, resolveDeal } from "../../access";
import { formatDateTime } from "../../format";
import { defineWriteTool, z } from "../define";
import { DEAL_GONE, WHEN, personName, sameWords } from "./common";

export const bookAppointment = defineWriteTool({
  name: "book_appointment",
  description:
    "Book or move the appointment on a Solar deal. Booking a deal at the front of the pipeline moves it to Appointment Set, exactly as the deal page does, and the confirmation says so. Omit deal_id for the deal on screen.",
  input: z.object({
    deal_id: z.guid().optional().describe("From find_deal. Omit for the deal on screen."),
    when: WHEN.describe("Date and time in the company's timezone, 24-hour: YYYY-MM-DDTHH:mm."),
  }),
  async prepare(ctx, { deal_id, when }) {
    const refused = refuseUnless(ctx.user, "update", "Lead", "book appointments");
    if (refused) return refused;
    const deal = await resolveDeal(ctx, deal_id);
    if (!deal.ok) return deal;
    const lead = await prisma.lead.findFirst({
      where: { id: deal.leadId, companyId: ctx.user.companyId },
      select: {
        firstName: true,
        lastName: true,
        vertical: true,
        pipelineId: true,
        stageId: true,
        stage: { select: { name: true } },
        appointmentAt: true,
        appointmentDisposition: true,
      },
    });
    if (!lead) return DEAL_GONE;

    const at = zonedWallClockToUtc(when, ctx.timeZone);
    if (Number.isNaN(at.getTime())) {
      return { ok: false, reason: "invalid", message: `"${when}" isn't a real date and time.`, leadId: deal.leadId };
    }
    const customer = personName(lead);
    const whenWords = formatDateTime(at, ctx.timeZone);
    if (lead.appointmentAt?.getTime() === at.getTime()) {
      return { ok: false, reason: "invalid", message: `${customer}'s appointment is already ${whenWords}.`, leadId: deal.leadId };
    }

    // The same two questions updateLeadPatchAction will ask, asked first so the
    // user hears the answer before saying yes. Both only read.
    const nextStageId = await resolveStageForAppointment({
      pipelineId: lead.pipelineId,
      candidateStageId: lead.stageId,
      hasAppointment: true,
    });
    const nextStage =
      nextStageId && nextStageId !== lead.stageId
        ? await prisma.pipelineStage.findUnique({ where: { id: nextStageId }, select: { name: true } })
        : null;
    const move = await planLeadAppointmentMove(ctx.user.companyId, lead, at);

    let summary = lead.appointmentAt
      ? `Move ${customer}'s appointment from ${formatDateTime(lead.appointmentAt, ctx.timeZone)} to ${whenWords}.`
      : `Book ${customer}'s appointment for ${whenWords}.`;
    if (nextStage) summary += ` That moves the deal from ${lead.stage?.name ?? "no stage"} to ${nextStage.name}.`;
    if (move?.clearedOutcome && lead.appointmentDisposition) {
      summary += ` It also clears the recorded outcome, "${lead.appointmentDisposition}".`;
    }

    return {
      ok: true,
      summary,
      leadId: deal.leadId,
      args: { deal_id: deal.leadId, when },
      plan: {
        leadId: deal.leadId,
        when,
        done:
          `${lead.appointmentAt ? "Moved" : "Booked"} ${customer}'s appointment for ${whenWords}.` +
          (nextStage ? ` The deal is now in ${nextStage.name}.` : ""),
      },
    };
  },
  async execute(_ctx, plan) {
    // The Summary card's own save: a wall-clock time in the company's zone.
    const res = await updateLeadPatchAction(plan.leadId, { appointmentAt: plan.when });
    if (!res.ok) return { ok: false, message: res.error };
    return { ok: true, done: plan.done, leadId: plan.leadId, entityType: "Lead", entityId: plan.leadId };
  },
});

export const setAppointmentOutcome = defineWriteTool({
  name: "set_appointment_outcome",
  description:
    "Record the outcome of a Solar deal's appointment, from the company's own list of Solar outcomes, with an optional note. Omit deal_id for the deal on screen.",
  input: z.object({
    deal_id: z.guid().optional().describe("From find_deal. Omit for the deal on screen."),
    outcome: z.string().trim().min(1).max(60).describe("One of the company's Solar appointment outcomes."),
    note: z.string().trim().max(2000).optional(),
  }),
  async prepare(ctx, { deal_id, outcome, note }) {
    const refused = refuseUnless(ctx.user, "update", "Lead", "record appointment outcomes");
    if (refused) return refused;
    const deal = await resolveDeal(ctx, deal_id);
    if (!deal.ok) return deal;
    const lead = await prisma.lead.findFirst({
      where: { id: deal.leadId, companyId: ctx.user.companyId },
      select: { firstName: true, lastName: true, appointmentDisposition: true },
    });
    if (!lead) return DEAL_GONE;

    // The picker only offers the company's list; the action itself accepts any
    // string, so the list is checked here rather than trusted to the model.
    const options = await getAppointmentDispositions(ctx.user.companyId, "solar");
    const match = options.find((o) => sameWords(o.label, outcome));
    if (!match) {
      return {
        ok: false,
        reason: "invalid",
        message: `"${outcome}" isn't one of this company's Solar appointment outcomes. The options are: ${options
          .map((o) => o.label)
          .join("; ")}.`,
        leadId: deal.leadId,
      };
    }
    const customer = personName(lead);
    const previous = lead.appointmentDisposition;
    if (previous === match.label && !note) {
      return {
        ok: false,
        reason: "invalid",
        message: `${customer}'s appointment outcome is already "${match.label}".`,
        leadId: deal.leadId,
      };
    }

    return {
      ok: true,
      summary:
        `Record ${customer}'s appointment outcome as "${match.label}"` +
        (previous && previous !== match.label ? `, replacing "${previous}"` : "") +
        (note ? `, with the note "${note}"` : "") +
        ".",
      leadId: deal.leadId,
      args: { deal_id: deal.leadId, outcome: match.label, ...(note ? { note } : {}) },
      plan: { leadId: deal.leadId, label: match.label, note, customer },
    };
  },
  async execute(_ctx, plan) {
    const res = await setAppointmentDispositionAction({
      leadId: plan.leadId,
      disposition: plan.label,
      ...(plan.note ? { note: plan.note } : {}),
    });
    if (!res.ok) return { ok: false, message: res.error };
    return {
      ok: true,
      done: `Recorded ${plan.customer}'s appointment outcome as "${plan.label}".`,
      leadId: plan.leadId,
      entityType: "Lead",
      entityId: plan.leadId,
    };
  },
});
