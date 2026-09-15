import { prisma } from "@/server/db/client";
import { can } from "@/server/rbac/guards";
import { formatMailingAddress } from "@/lib/address";
import { zonedWallClockToUtc } from "@/lib/tz";
import { createLeadAction, type LeadInput } from "@/server/modules/leads/manage";
import { getLeadFormOptions } from "@/server/modules/leads/queries";
import { resolveOwningRepId } from "@/server/modules/leads/owning-rep";
import { resolveStageForAppointment } from "@/server/modules/leads/staging";
import { refuseUnless } from "../../access";
import { formatDateTime } from "../../format";
import { defineWriteTool, z } from "../define";
import { WHEN, sameWords } from "./common";

const invalid = (message: string) => ({ ok: false as const, reason: "invalid" as const, message });

export const createLead = defineWriteTool({
  name: "create_lead",
  description:
    "Create a new Solar lead, as the New Lead form does. First and last name are required; ask for anything the tool says is missing. The user is asked to confirm first.",
  input: z.object({
    first_name: z.string().trim().min(1).max(80),
    last_name: z.string().trim().min(1).max(80),
    phone: z.string().trim().max(30).optional(),
    email: z.email().optional(),
    address: z.string().trim().max(160).optional().describe("Street address."),
    city: z.string().trim().max(80).optional(),
    state: z.string().trim().max(40).optional(),
    zip: z.string().trim().max(12).optional(),
    appointment_at: WHEN.optional().describe("Appointment in the company's timezone, 24-hour: YYYY-MM-DDTHH:mm."),
    utility_provider: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(4000).optional(),
    custom_fields: z
      .record(z.string(), z.string())
      .optional()
      .describe("Answers to the company's own lead fields, keyed by the field's label."),
  }),
  async prepare(ctx, input) {
    const refused = refuseUnless(ctx.user, "create", "Lead", "create leads");
    if (refused) return refused;
    const { companyId, userId } = ctx.user;

    // The form's field list for this workspace. Required fields are enforced by
    // the New Lead form in the browser, not by createLeadAction, so Nova holds
    // itself to the form here rather than creating a lead the form would refuse.
    const { fieldDefs } = await getLeadFormOptions(companyId, "solar");
    const custom: Record<string, string> = {};
    const labels: string[] = [];
    for (const [said, rawValue] of Object.entries(input.custom_fields ?? {})) {
      const def = fieldDefs.find((f) => sameWords(f.label, said) || f.key === said);
      if (!def) {
        const known = fieldDefs.map((f) => f.label).join(", ");
        return invalid(`New Solar leads have no field called "${said}".${known ? ` The fields are: ${known}.` : ""}`);
      }
      let value = rawValue.trim();
      if (def.options.length > 0 && value) {
        const option = def.options.find((o) => sameWords(o, value));
        if (!option) return invalid(`"${rawValue}" isn't an option for ${def.label}. The options are: ${def.options.join(", ")}.`);
        value = option;
      }
      if (value) {
        custom[def.key] = value;
        labels.push(`${def.label}: ${value}`);
      }
    }
    const missing = fieldDefs.filter((f) => f.required && !custom[f.key]);
    if (missing.length > 0) {
      const asks = missing.map((f) => (f.options.length ? `${f.label} (${f.options.join(", ")})` : f.label));
      return invalid(`A new Solar lead needs ${asks.join(" and ")}. What should I put?`);
    }

    const appointmentAt = input.appointment_at ? zonedWallClockToUtc(input.appointment_at, ctx.timeZone) : null;
    if (appointmentAt && Number.isNaN(appointmentAt.getTime())) {
      return invalid(`"${input.appointment_at}" isn't a real date and time.`);
    }

    // What createLeadAction will decide, asked the same way so the user hears it
    // first: who it goes to, and which stage it lands in.
    const ownerId = can(ctx.user, "assign", "Lead") ? null : await resolveOwningRepId(companyId, userId);
    const owner = ownerId ? await prisma.user.findUnique({ where: { id: ownerId }, select: { firstName: true, lastName: true } }) : null;
    const pipeline = await prisma.pipeline.findFirst({
      where: { companyId, vertical: "solar" },
      orderBy: { isDefault: "desc" },
      select: { id: true },
    });
    const stageId = await resolveStageForAppointment({
      pipelineId: pipeline?.id ?? null,
      candidateStageId: null,
      hasAppointment: appointmentAt != null,
    });
    const stage = stageId ? await prisma.pipelineStage.findUnique({ where: { id: stageId }, select: { name: true } }) : null;

    const name = `${input.first_name} ${input.last_name}`;
    const address = formatMailingAddress(input);
    const details = [
      input.phone && `phone ${input.phone}`,
      input.email && `email ${input.email}`,
      address && `at ${address}`,
      input.utility_provider && `utility ${input.utility_provider}`,
      ...labels,
      appointmentAt && `with an appointment on ${formatDateTime(appointmentAt, ctx.timeZone)}`,
    ].filter(Boolean);
    const assignedTo = !ownerId
      ? "unassigned"
      : ownerId === userId
        ? "assigned to you"
        : `assigned to ${owner ? `${owner.firstName} ${owner.lastName}`.trim() : "your rep"}`;

    const lead: LeadInput = {
      firstName: input.first_name,
      lastName: input.last_name,
      phone: input.phone ?? "",
      email: input.email ?? "",
      address: input.address ?? "",
      city: input.city ?? "",
      state: input.state ?? "",
      zip: input.zip ?? "",
      appointmentAt: input.appointment_at ?? "",
      utilityProvider: input.utility_provider ?? "",
      notes: input.notes ?? "",
      customFields: custom,
      // The form's own defaults for what it sends and Nova does not ask about.
      // serviceType follows the workspace inside the action.
      serviceType: "solar",
      dealType: "insurance",
      valueCents: 0,
      priority: "medium",
    };

    return {
      ok: true,
      summary:
        `Create a Solar lead for ${name}${details.length ? `, ${details.join(", ")}` : ""}. ` +
        `It will be ${assignedTo}${stage ? ` and start in ${stage.name}` : ""}.`,
      leadId: null,
      args: input,
      plan: { lead, name },
    };
  },
  async execute(_ctx, plan) {
    const res = await createLeadAction(plan.lead);
    if (!res.ok) return { ok: false, message: res.error };
    return { ok: true, done: `Created a Solar lead for ${plan.name}.`, leadId: res.id, entityType: "Lead", entityId: res.id };
  },
});
