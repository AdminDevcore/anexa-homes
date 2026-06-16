import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { buildAutofillContext, fillTokens, type AutofillContext } from "@/server/modules/esign/autofill";
import { sha256, generateSignerToken } from "@/server/modules/esign/tokens";
import { parseItems, type WelcomeCallContent } from "./types";

// Lead fields needed to resolve merge tokens for a welcome call.
const LEAD_SELECT = {
  companyId: true,
  firstName: true,
  lastName: true,
  email: true,
  phone: true,
  address: true,
  city: true,
  state: true,
  zip: true,
  status: true,
  createdAt: true,
  customFields: true,
  assignedRepId: true,
  source: { select: { name: true } },
  assignedRep: { select: { firstName: true, lastName: true } },
  project: {
    select: { id: true, projectNumber: true, serviceType: true, status: true, contractValue: true, customFields: true, manager: { select: { firstName: true, lastName: true } } },
  },
} as const;

type LeadRow = NonNullable<Awaited<ReturnType<typeof loadLead>>>;
function loadLead(leadId: string, companyId: string) {
  return prisma.lead.findFirst({ where: { id: leadId, companyId }, select: LEAD_SELECT });
}

function ctxForLead(lead: LeadRow, companyName: string): AutofillContext {
  const custom: Record<string, string> = {};
  const merge = (obj: unknown) => {
    if (obj && typeof obj === "object") for (const [k, v] of Object.entries(obj as Record<string, unknown>)) custom[k] = v == null ? "" : String(v);
  };
  merge(lead.customFields);
  merge(lead.project?.customFields);
  const name = (u: { firstName: string; lastName: string } | null | undefined) => (u ? `${u.firstName} ${u.lastName}`.trim() : null);
  return buildAutofillContext({
    firstName: lead.firstName,
    lastName: lead.lastName,
    email: lead.email,
    phone: lead.phone,
    street: lead.address,
    city: lead.city,
    state: lead.state,
    zip: lead.zip,
    projectNumber: lead.project?.projectNumber,
    projectType: lead.project?.serviceType,
    projectStage: lead.project?.status,
    projectValueCents: lead.project?.contractValue,
    rep: name(lead.assignedRep),
    pm: name(lead.project?.manager),
    leadSource: lead.source?.name,
    leadCreatedAt: lead.createdAt,
    leadStatus: lead.status,
    companyName,
    custom,
  });
}

/** Resolve a template's intro/closing/items against the deal — frozen into the session snapshot. */
function resolveContent(tpl: { intro: string | null; closing: string | null; items: unknown }, ctx: AutofillContext): WelcomeCallContent {
  return {
    intro: fillTokens(tpl.intro ?? "", ctx),
    closing: fillTokens(tpl.closing ?? "", ctx),
    items: parseItems(tpl.items).map((it) => ({ id: it.id, title: fillTokens(it.title, ctx), body: fillTokens(it.body, ctx) })),
  };
}

const appUrl = () => (process.env.NEXT_PUBLIC_APP_URL || "").replace(/\/$/, "");

/**
 * Create a welcome-call session for a deal: resolve + snapshot the template against
 * the lead, generate a public token, email the customer the link. Returns the link.
 */
export async function createWelcomeCall(companyId: string, userId: string, leadId: string, templateId: string) {
  const [lead, tpl, company] = await Promise.all([
    loadLead(leadId, companyId),
    prisma.welcomeCallTemplate.findFirst({ where: { id: templateId, companyId }, select: { id: true, intro: true, closing: true, items: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ]);
  if (!lead) return { ok: false as const, error: "Lead not found." };
  if (!tpl) return { ok: false as const, error: "Template not found." };

  const ctx = ctxForLead(lead, company?.name ?? "Anexa Homes");
  const snapshot = resolveContent(tpl, ctx);
  if (snapshot.items.length === 0) return { ok: false as const, error: "This template has no confirmation items yet." };

  const token = generateSignerToken();
  const session = await prisma.welcomeCallSession.create({
    data: {
      companyId,
      templateId: tpl.id,
      leadId,
      projectId: lead.project?.id ?? null,
      customerName: ctx.customer.fullName || "Customer",
      customerEmail: lead.email,
      status: "sent",
      tokenHash: token.hash,
      snapshot,
      createdById: userId,
    },
    select: { id: true },
  });

  const url = `${appUrl()}/welcome/${token.raw}`;
  if (lead.email) {
    const brand = await emailBrandFor(companyId);
    const tpl2 = brandedEmailTemplate({
      brand: brand.brand,
      subject: `Welcome to ${company?.name ?? "your project"} — please confirm your details`,
      heading: `Welcome, ${ctx.customer.firstName || "there"}!`,
      paragraphs: [
        snapshot.intro || "Please take a moment to review and confirm the details of your project.",
        "Click below to review everything and confirm it's correct — it only takes a minute.",
      ],
      cta: { label: "Review & confirm", url },
    });
    await sendEmail(lead.email, tpl2.subject, tpl2.text, { fromName: brand.fromName, html: tpl2.html });
  }

  return { ok: true as const, sessionId: session.id, url, emailed: !!lead.email };
}

/** Regenerate the token + re-send (or re-surface) the link for an existing session. */
export async function resendWelcomeCall(companyId: string, sessionId: string) {
  const s = await prisma.welcomeCallSession.findFirst({
    where: { id: sessionId, companyId },
    select: { id: true, status: true, customerEmail: true, snapshot: true, lead: { select: { firstName: true } } },
  });
  if (!s) return { ok: false as const, error: "Welcome call not found." };
  if (s.status === "completed") return { ok: false as const, error: "This welcome call is already completed." };

  const token = generateSignerToken();
  await prisma.welcomeCallSession.update({ where: { id: sessionId }, data: { tokenHash: token.hash, status: "sent", sentAt: new Date() } });
  const url = `${appUrl()}/welcome/${token.raw}`;

  if (s.customerEmail) {
    const brand = await emailBrandFor(companyId);
    const intro = (s.snapshot as { intro?: string } | null)?.intro || "Please review and confirm the details of your project.";
    const tpl = brandedEmailTemplate({
      brand: brand.brand,
      subject: `Reminder: please confirm your project details`,
      heading: `Hi ${s.lead?.firstName || "there"}!`,
      paragraphs: [intro, "Here's your link again — click below to review and confirm."],
      cta: { label: "Review & confirm", url },
    });
    await sendEmail(s.customerEmail, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
  }
  return { ok: true as const, url, emailed: !!s.customerEmail };
}

export async function voidWelcomeCall(companyId: string, sessionId: string) {
  const s = await prisma.welcomeCallSession.findFirst({ where: { id: sessionId, companyId }, select: { id: true } });
  if (!s) return { ok: false as const, error: "Welcome call not found." };
  await prisma.welcomeCallSession.update({ where: { id: sessionId }, data: { status: "voided", voidedAt: new Date() } });
  return { ok: true as const };
}

export type WelcomeCallView =
  | { state: "invalid" }
  | { state: "voided" }
  | { state: "completed"; customerName: string; snapshot: WelcomeCallContent }
  | { state: "active"; sessionId: string; customerName: string; snapshot: WelcomeCallContent; acknowledged: string[] };

/** Public lookup by raw token. Records the first view. Used by the /welcome/[token] page. */
export async function getWelcomeCallByToken(rawToken: string): Promise<WelcomeCallView> {
  const session = await prisma.welcomeCallSession.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: { id: true, status: true, customerName: true, snapshot: true, acknowledged: true },
  });
  if (!session) return { state: "invalid" };
  const snapshot = session.snapshot as WelcomeCallContent;
  if (session.status === "voided") return { state: "voided" };
  if (session.status === "completed") return { state: "completed", customerName: session.customerName, snapshot };
  if (session.status === "sent") {
    await prisma.welcomeCallSession.update({ where: { id: session.id }, data: { status: "viewed", viewedAt: new Date() } });
  }
  const acknowledged = Array.isArray(session.acknowledged) ? (session.acknowledged as string[]) : [];
  return { state: "active", sessionId: session.id, customerName: session.customerName, snapshot, acknowledged };
}

/** Customer confirmation. Validates every snapshot item was acknowledged, then completes + notifies the rep. */
export async function confirmWelcomeCall(rawToken: string, ackedIds: string[], ip: string | null) {
  const session = await prisma.welcomeCallSession.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: { id: true, companyId: true, status: true, customerName: true, snapshot: true, leadId: true },
  });
  if (!session) return { ok: false as const, error: "This link is no longer valid." };
  if (session.status === "voided") return { ok: false as const, error: "This link is no longer active." };
  if (session.status === "completed") return { ok: true as const }; // idempotent

  const snapshot = session.snapshot as WelcomeCallContent;
  const acked = new Set(ackedIds);
  const allAcked = snapshot.items.every((it) => acked.has(it.id));
  if (!allAcked) return { ok: false as const, error: "Please acknowledge every item before confirming." };

  await prisma.welcomeCallSession.update({
    where: { id: session.id },
    data: { status: "completed", completedAt: new Date(), acknowledged: ackedIds, confirmedIp: ip },
  });

  // Notify the assigned rep (in-app + email).
  const lead = await prisma.lead.findUnique({
    where: { id: session.leadId },
    select: { assignedRepId: true, assignedRep: { select: { email: true, firstName: true } } },
  });
  if (lead?.assignedRepId) {
    const title = `✅ Welcome call confirmed — ${session.customerName}`;
    const body = `${session.customerName} reviewed and confirmed their project details.`;
    const link = `/portal/leads/${session.leadId}`;
    await prisma.notification.create({
      data: { companyId: session.companyId, userId: lead.assignedRepId, event: "document_completed", title, body, link, channel: "in_app" },
    });
    if (lead.assignedRep?.email) {
      const brand = await emailBrandFor(session.companyId);
      const tpl = brandedEmailTemplate({ brand: brand.brand, subject: title, heading: title, paragraphs: [body], cta: { label: "View the deal", url: `${appUrl()}${link}` } });
      await sendEmail(lead.assignedRep.email, tpl.subject, tpl.text, { fromName: brand.fromName, html: tpl.html });
    }
  }

  return { ok: true as const };
}
