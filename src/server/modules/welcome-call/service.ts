import { prisma } from "@/server/db/client";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { buildAutofillContext, fillTokens, type AutofillContext } from "@/server/modules/esign/autofill";
import { sha256, generateSignerToken } from "@/server/modules/esign/tokens";
import { parseItems, CALL_KIND_LABELS, type WelcomeCallContent, type CallKind } from "./types";
import { startAvatarGeneration, syncAvatarSegments, parseSegments } from "./avatar";
import { getObject, putObject } from "@/server/storage";
import type { CallMode } from "@prisma/client";
import { runUnscoped } from "@/server/vertical/context";

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
    prisma.welcomeCallTemplate.findFirst({ where: { id: templateId, companyId }, select: { id: true, kind: true, mode: true, intro: true, closing: true, items: true } }),
    prisma.company.findUnique({ where: { id: companyId }, select: { name: true } }),
  ]);
  if (!lead) return { ok: false as const, error: "Lead not found." };
  if (!tpl) return { ok: false as const, error: "Template not found." };

  const ctx = ctxForLead(lead, company?.name ?? "Anexa Homes");
  const snapshot = resolveContent(tpl, ctx);
  if (snapshot.items.length === 0) return { ok: false as const, error: "This template has no confirmation items yet." };

  const isAvatar = tpl.mode === "avatar";
  const token = generateSignerToken();
  const session = await prisma.welcomeCallSession.create({
    data: {
      companyId,
      templateId: tpl.id,
      kind: tpl.kind,
      mode: tpl.mode,
      leadId,
      projectId: lead.project?.id ?? null,
      customerName: ctx.customer.fullName || "Customer",
      customerEmail: lead.email,
      status: "sent",
      avatarStatus: isAvatar ? "generating" : "none",
      tokenHash: token.hash,
      snapshot,
      createdById: userId,
    },
    select: { id: true },
  });

  // Avatar mode: kick off HeyGen clip generation (or TTS placeholders if unconfigured).
  if (isAvatar) {
    try { await startAvatarGeneration(session.id, snapshot); } catch { /* leaves status generating; sync retries */ }
  }

  const url = `${appUrl()}/welcome/${token.raw}`;
  if (lead.email) {
    const brand = await emailBrandFor(companyId);
    const isCompletion = tpl.kind === "completion";
    const tpl2 = brandedEmailTemplate({
      brand: brand.brand,
      subject: isAvatar
        ? `Your ${isCompletion ? "completion" : "welcome"} video call from ${company?.name ?? "us"}`
        : isCompletion
          ? `Your project with ${company?.name ?? "us"} is complete — please confirm`
          : `Welcome to ${company?.name ?? "your project"} — please confirm your details`,
      heading: isCompletion ? `Thank you, ${ctx.customer.firstName || "there"}!` : `Welcome, ${ctx.customer.firstName || "there"}!`,
      paragraphs: isAvatar
        ? [
            snapshot.intro || "We've prepared a short video call to go over your project together.",
            "Click below to start — it takes about a minute, and you'll just answer a few quick questions on camera.",
          ]
        : [
            snapshot.intro ||
              (isCompletion
                ? "Your project is complete. Please take a moment to review and confirm everything looks right."
                : "Please take a moment to review and confirm the details of your project."),
            "Click below to review everything and confirm it's correct — it only takes a minute.",
          ],
      cta: { label: isAvatar ? "Start your video call" : "Review & confirm", url },
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

/** A clip the avatar-call client plays in order: a HeyGen video, or a browser-TTS card. */
export type PlaySegment = { key: string; text: string; kind: "video" | "tts"; url: string | null };

export type WelcomeCallView =
  | { state: "invalid" }
  | { state: "voided" }
  | { state: "completed"; customerName: string; kind: CallKind; mode: CallMode; snapshot: WelcomeCallContent }
  | {
      state: "active";
      sessionId: string;
      customerName: string;
      kind: CallKind;
      mode: CallMode;
      snapshot: WelcomeCallContent;
      acknowledged: string[];
      avatarStatus: "none" | "generating" | "ready" | "failed";
      segments: PlaySegment[];
    };

/** Map stored avatar segments to client-playable clips (only the ready ones). */
function playSegments(rawToken: string, segmentsJson: unknown): PlaySegment[] {
  return parseSegments(segmentsJson)
    .filter((s) => s.status === "ready")
    .map((s) =>
      s.storageKey
        ? { key: s.key, text: s.text, kind: "video" as const, url: `/api/welcome-call/${rawToken}/clip/${encodeURIComponent(s.key)}` }
        : { key: s.key, text: s.text, kind: "tts" as const, url: null },
    );
}

/** Public lookup by raw token. Records the first view. Used by the /welcome/[token] page. */
export async function getWelcomeCallByToken(rawToken: string): Promise<WelcomeCallView> {
  return runUnscoped(
    "public token page: the unguessable token is the authorization and identifies exactly one row, whose vertical is not known until it is read",
    () => loadWelcomeCallByToken(rawToken)
  );
}

async function loadWelcomeCallByToken(rawToken: string): Promise<WelcomeCallView> {
  const session = await prisma.welcomeCallSession.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: { id: true, kind: true, mode: true, status: true, customerName: true, snapshot: true, acknowledged: true, avatarStatus: true, segments: true },
  });
  if (!session) return { state: "invalid" };
  const snapshot = session.snapshot as WelcomeCallContent;
  if (session.status === "voided") return { state: "voided" };
  if (session.status === "completed") return { state: "completed", customerName: session.customerName, kind: session.kind, mode: session.mode, snapshot };
  if (session.status === "sent") {
    await prisma.welcomeCallSession.update({ where: { id: session.id }, data: { status: "viewed", viewedAt: new Date() } });
  }
  const acknowledged = Array.isArray(session.acknowledged) ? (session.acknowledged as string[]) : [];
  return {
    state: "active",
    sessionId: session.id,
    customerName: session.customerName,
    kind: session.kind,
    mode: session.mode,
    snapshot,
    acknowledged,
    avatarStatus: session.avatarStatus,
    segments: session.mode === "avatar" ? playSegments(rawToken, session.segments) : [],
  };
}

/** Poll HeyGen for an avatar session's clips (called by the customer page while "preparing"). */
export async function pollAvatarCall(rawToken: string): Promise<{ avatarStatus: string; segments: PlaySegment[] }> {
  const session = await prisma.welcomeCallSession.findUnique({ where: { tokenHash: sha256(rawToken) }, select: { id: true } });
  if (!session) return { avatarStatus: "failed", segments: [] };
  await syncAvatarSegments(session.id);
  const fresh = await prisma.welcomeCallSession.findUnique({ where: { id: session.id }, select: { avatarStatus: true, segments: true } });
  return { avatarStatus: fresh?.avatarStatus ?? "generating", segments: playSegments(rawToken, fresh?.segments) };
}

/** Stream one ready avatar clip for the public call page (gated by the unguessable token). */
export async function getAvatarClip(rawToken: string, key: string): Promise<Buffer | null> {
  const s = await prisma.welcomeCallSession.findUnique({ where: { tokenHash: sha256(rawToken) }, select: { segments: true } });
  if (!s) return null;
  const seg = parseSegments(s.segments).find((x) => x.key === key && x.status === "ready" && x.storageKey);
  if (!seg?.storageKey) return null;
  try { return await getObject(seg.storageKey); } catch { return null; }
}

/** Store the recorded call video (from the customer's browser) and complete the session. */
export async function storeAvatarRecording(rawToken: string, buffer: Buffer, ip: string | null) {
  const s = await prisma.welcomeCallSession.findUnique({ where: { tokenHash: sha256(rawToken) }, select: { id: true, status: true } });
  if (!s) return { ok: false as const, error: "This link is no longer valid." };
  const key = `welcome-calls/${s.id}/recording.webm`;
  await putObject(key, buffer);
  return completeAvatarCall(rawToken, key, ip);
}

/** Staff playback: fetch a completed call recording (company-scoped). */
export async function getCallRecording(companyId: string, sessionId: string): Promise<Buffer | null> {
  const s = await prisma.welcomeCallSession.findFirst({ where: { id: sessionId, companyId }, select: { recordingStorageKey: true } });
  if (!s?.recordingStorageKey) return null;
  try { return await getObject(s.recordingStorageKey); } catch { return null; }
}

/** Avatar mode: store the recorded call video and complete the session. */
export async function completeAvatarCall(rawToken: string, recordingStorageKey: string, ip: string | null) {
  const session = await prisma.welcomeCallSession.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: { id: true, companyId: true, kind: true, status: true, customerName: true, leadId: true },
  });
  if (!session) return { ok: false as const, error: "This link is no longer valid." };
  if (session.status === "completed") return { ok: true as const };
  await prisma.welcomeCallSession.update({
    where: { id: session.id },
    data: { status: "completed", completedAt: new Date(), recordingStorageKey, recordedAt: new Date(), confirmedIp: ip },
  });
  await notifyRepCallConfirmed(session);
  return { ok: true as const };
}

/** Notify the assigned rep that a call was confirmed (in-app + email). Shared by both modes. */
async function notifyRepCallConfirmed(session: { id: string; companyId: string; kind: CallKind; customerName: string; leadId: string }) {
  const lead = await prisma.lead.findUnique({
    where: { id: session.leadId },
    select: { assignedRepId: true, assignedRep: { select: { email: true } } },
  });
  if (!lead?.assignedRepId) return;
  const title = `✅ ${CALL_KIND_LABELS[session.kind]} confirmed — ${session.customerName}`;
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

/** Customer confirmation. Validates every snapshot item was acknowledged, then completes + notifies the rep. */
export async function confirmWelcomeCall(rawToken: string, ackedIds: string[], ip: string | null) {
  const session = await prisma.welcomeCallSession.findUnique({
    where: { tokenHash: sha256(rawToken) },
    select: { id: true, companyId: true, kind: true, status: true, customerName: true, snapshot: true, leadId: true },
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

  await notifyRepCallConfirmed(session);
  return { ok: true as const };
}
