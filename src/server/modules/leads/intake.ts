"use server";

import { z } from "zod";
import type { Role } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { serviceTypeFromSlug } from "@/lib/service-types";
import { verticalForServiceSlug, DEFAULT_VERTICAL } from "@/lib/vertical";
import { runInVertical } from "@/server/vertical/context";
import { solarVerticalEnabled } from "@/server/vertical/flag";
import { fireEvent } from "@/server/modules/notifications/engine";
import { sendEmail, sendSms } from "@/server/modules/notifications/delivery";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { resolveStageForAppointment } from "./staging";
import { guardedStageId } from "@/server/modules/pipeline/contract-signed";
import { zonedWallClockToUtc } from "@/lib/tz";
import { COMPANY } from "@/lib/site";

/**
 * Balanced round-robin: assign the new web lead to the active sales rep with
 * the fewest leads (falls back to managers, then null). Drives speed-to-lead.
 */
async function pickAssignedRep(companyId: string): Promise<string | null> {
  for (const roles of [["sales_rep"], ["manager"]] as Role[][]) {
    const reps = await prisma.user.findMany({
      where: { companyId, status: "active", role: { in: roles } },
      select: { id: true, _count: { select: { leadsAssigned: true } } },
    });
    if (reps.length === 0) continue;
    reps.sort((a, b) => a._count.leadsAssigned - b._count.leadsAssigned);
    return reps[0].id;
  }
  return null;
}

const websiteLeadSchema = z.object({
  firstName: z.string().min(1, "First name is required").max(80),
  lastName: z.string().min(1, "Last name is required").max(80),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(7, "Enter a valid phone").max(30),
  address: z.string().max(160).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  zip: z.string().max(12).optional().or(z.literal("")),
  service: z.string().max(40).optional().or(z.literal("")),
  type: z.enum(["inspection", "claim", "general", "careers"]).default("inspection"),
  message: z.string().max(2000).optional().or(z.literal("")),
  // Appointment request + qualifying details (from the booking form).
  preferredDate: z.string().max(20).optional().or(z.literal("")),
  preferredTime: z.string().max(20).optional().or(z.literal("")),
  propertyType: z.string().max(48).optional().or(z.literal("")),
  homeowner: z.string().max(12).optional().or(z.literal("")),
  timeframe: z.string().max(48).optional().or(z.literal("")),
});

type WebsiteLeadInput = z.infer<typeof websiteLeadSchema>;
type WebsiteLeadData = z.output<typeof websiteLeadSchema>;

// Preferred time windows → the start hour used to build the appointment timestamp.
const TIME_WINDOWS: Record<string, { label: string; hour: number }> = {
  morning: { label: "Morning (8–11 AM)", hour: 8 },
  midday: { label: "Midday (11 AM–2 PM)", hour: 11 },
  afternoon: { label: "Afternoon (2–5 PM)", hour: 14 },
  evening: { label: "Evening (5–7 PM)", hour: 17 },
};

const PRIMARY_COMPANY_SLUG = "anexa-homes";

async function resolvePrimaryCompany() {
  const company =
    (await prisma.company.findUnique({ where: { slug: PRIMARY_COMPANY_SLUG } })) ??
    (await prisma.company.findFirst({ orderBy: { createdAt: "asc" } }));
  return company;
}

export async function submitWebsiteLead(
  input: WebsiteLeadInput
): Promise<{ ok: true } | { ok: false; error: string }> {
  const parsed = websiteLeadSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid submission" };
  }
  const data = parsed.data;

  // The website has no portal session, so this path declares its own vertical
  // rather than inheriting one: the service the homeowner picked decides which
  // workspace the enquiry lands in. With the flag off everything is roofing,
  // exactly as before.
  const vertical = solarVerticalEnabled() ? verticalForServiceSlug(data.service) : DEFAULT_VERTICAL;
  return runInVertical(vertical, () => createWebsiteLead(data, vertical));
}

async function createWebsiteLead(
  data: WebsiteLeadData,
  vertical: ReturnType<typeof verticalForServiceSlug>
): Promise<{ ok: true } | { ok: false; error: string }> {

  const company = await resolvePrimaryCompany();
  if (!company) {
    return { ok: false, error: "We couldn't process your request. Please call us directly." };
  }

  const pipeline = await prisma.pipeline.findFirst({
    where: { companyId: company.id },
    orderBy: { isDefault: "desc" },
    include: { stages: { orderBy: { position: "asc" }, take: 1 } },
  });

  const source = await prisma.leadSource.upsert({
    where: { companyId_vertical_name: { companyId: company.id, vertical, name: "Website" } },
    update: {},
    create: { companyId: company.id, vertical, name: "Website" },
  });

  // Build the requested appointment timestamp from the chosen date + time window.
  let appointmentAt: Date | null = null;
  let apptLabel = "";
  if (data.preferredDate) {
    const win = data.preferredTime ? TIME_WINDOWS[data.preferredTime] : undefined;
    const hour = win?.hour ?? 9;
    // Interpret the chosen date + window as the company's LOCAL time, not the
    // server's UTC — otherwise a 2 PM pick is stored as 14:00Z and shows as 9 AM.
    const dt = zonedWallClockToUtc(`${data.preferredDate}T${String(hour).padStart(2, "0")}:00:00`, company.timezone);
    if (!Number.isNaN(dt.getTime())) {
      appointmentAt = dt;
      apptLabel = `${data.preferredDate}${win ? ` · ${win.label}` : ""}`;
    }
  }

  const noteParts = [
    data.type === "claim" ? "[Insurance Claim Request]" : null,
    data.type === "careers" ? "[Careers Application]" : null,
    appointmentAt ? `Requested appointment: ${apptLabel}` : null,
    data.propertyType ? `Property type: ${data.propertyType}` : null,
    data.homeowner ? `Homeowner: ${data.homeowner}` : null,
    data.timeframe ? `Project timeframe: ${data.timeframe}` : null,
    data.service ? `Service interest: ${data.service}` : null,
    data.message ? `Message: ${data.message}` : null,
  ].filter(Boolean);

  // Careers applications shouldn't be round-robin'd to sales reps.
  const assignedRepId = data.type === "careers" ? null : await pickAssignedRep(company.id);

  // A requested appointment date lands the lead in "Appointment Set"; otherwise New Lead.
  const resolvedStageId = await resolveStageForAppointment({
    pipelineId: pipeline?.id ?? null,
    candidateStageId: null,
    hasAppointment: Boolean(appointmentAt),
  });
  // A web lead never lands at or past Contract Signed, however a pipeline is
  // ordered — see guardedStageId.
  const guard = await guardedStageId({
    companyId: company.id,
    lead: { id: null, vertical, stageId: null },
    resolvedStageId,
    explicitStageId: null,
    fallbackStageId: pipeline?.stages[0]?.id ?? null,
  });
  const stageId = guard.ok ? guard.stageId : (pipeline?.stages[0]?.id ?? null);

  const lead = await prisma.lead.create({
    data: {
      companyId: company.id,
      firstName: data.firstName,
      lastName: data.lastName,
      email: data.email.toLowerCase(),
      phone: data.phone,
      address: data.address || null,
      city: data.city || null,
      zip: data.zip || null,
      pipelineId: pipeline?.id ?? null,
      stageId,
      stageChangedAt: new Date(),
      sourceId: source.id,
      assignedRepId,
      serviceType: serviceTypeFromSlug(data.service),
      claimStatus: data.type === "claim" ? "filed" : "not_filed",
      appointmentAt,
      notes: noteParts.join("\n") || null,
    },
    select: { id: true },
  });

  await prisma.activityLog.create({
    data: {
      companyId: company.id,
      type: "system",
      message: `New website ${data.type} lead: ${data.firstName} ${data.lastName}`,
    },
  });

  // Speed-to-lead: alert staff (per their notification rules) and, if assigned,
  // notify the owning rep. Best-effort — never blocks the homeowner's response.
  await fireEvent({ companyId: company.id, event: "lead_created", leadId: lead.id });
  if (assignedRepId) {
    await fireEvent({ companyId: company.id, event: "lead_assigned", leadId: lead.id });
  }

  // Instant confirmation to the homeowner themselves (they aren't a CRM user,
  // so this goes direct rather than through the role-based engine).
  await sendHomeownerConfirmation(company.id, data);

  return { ok: true };
}

async function sendHomeownerConfirmation(companyId: string, data: WebsiteLeadInput): Promise<void> {
  const { brand, fromName } = await emailBrandFor(companyId);
  const phone = brand.contact?.phone ?? COMPANY.phone;

  if (data.type === "careers") {
    const tpl = brandedEmailTemplate({
      brand,
      subject: `We received your application — ${brand.companyName}`,
      heading: "Thanks for applying",
      paragraphs: [
        `Hi ${data.firstName},`,
        `Thanks for applying to join the ${brand.companyName} team. Our hiring team will review your application and reach out soon.`,
      ],
    });
    await sendEmail(data.email, tpl.subject, tpl.text, { fromName, html: tpl.html });
    return;
  }

  const win = data.preferredTime ? TIME_WINDOWS[data.preferredTime] : undefined;
  const slot = data.preferredDate ? `${data.preferredDate}${win ? ` (${win.label})` : ""}` : "";
  const tpl = brandedEmailTemplate({
    brand,
    subject: `We got your request — ${brand.companyName}`,
    heading: "We've got your request",
    paragraphs: [
      `Hi ${data.firstName},`,
      `Thanks for reaching out to ${brand.companyName}. We've received your ${
        data.type === "claim" ? "insurance claim support" : "free inspection"
      } request${slot ? ` for ${slot}` : ""}, and a specialist will contact you shortly — usually within one business hour — to confirm${
        slot ? " your appointment" : " a time"
      }.`,
      `Need us sooner? Call ${phone}.`,
    ],
  });

  await Promise.allSettled([
    sendEmail(data.email, tpl.subject, tpl.text, { fromName, html: tpl.html }),
    sendSms(
      data.phone,
      `Anexa Homes: Thanks ${data.firstName}! We received your request and will call you shortly. Questions? ${COMPANY.phone}`
    ),
  ]);
}
