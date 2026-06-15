import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { requireCan } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { putObject, getObject } from "@/server/storage";
import { fireEvent } from "@/server/modules/notifications/engine";
import { sendEmail } from "@/server/modules/notifications/delivery";
import { brandedEmailTemplate } from "@/server/modules/notifications/email-templates";
import { emailBrandFor } from "@/server/modules/notifications/brand";
import { generateSignerToken, sha256 } from "./tokens";
import { appendDocumentEvent } from "./audit";
import { buildAutofillContext, type AutofillContext } from "./autofill";
import {
  generateSignedPdf,
  type Snapshot,
  type SnapshotField,
  type FilledValue,
} from "./pdf";

// ---------------------------------------------------------------------------
// Send for signature (staff)
// ---------------------------------------------------------------------------

export type SendInput = {
  templateId: string;
  leadId: string;
  signers: { role: "customer" | "co_customer" | "company_rep" | "witness"; name: string; email?: string; order: number }[];
};

/**
 * Email a signer their secure signing link (best-effort — caller wraps so a
 * failed email never aborts the send/resend). In dev with no RESEND_API_KEY the
 * delivery helper logs to console.
 */
async function emailSigningLink(opts: {
  to: string;
  signerName: string;
  companyId: string;
  companyName: string;
  title: string;
  url: string;
  reminder: boolean;
}): Promise<void> {
  const { brand, fromName } = await emailBrandFor(opts.companyId);
  const tpl = brandedEmailTemplate({
    brand,
    subject: opts.reminder ? `Reminder: please sign ${opts.title}` : `Please sign ${opts.title}`,
    preheader: `${opts.companyName} sent you a document to review and sign.`,
    heading: opts.reminder ? "Your document is waiting" : "You have a document to sign",
    paragraphs: [
      `Hi ${opts.signerName},`,
      opts.reminder
        ? `This is a reminder to review and sign "${opts.title}" from ${opts.companyName}.`
        : `${opts.companyName} has sent you "${opts.title}" to review and sign — it only takes a minute.`,
    ],
    cta: { label: "Review & sign", url: opts.url },
    note: "This link is private to you — please don't forward it.",
  });
  await sendEmail(opts.to, tpl.subject, tpl.text, { fromName, html: tpl.html });
}

export async function sendForSignature(user: SessionUser, input: SendInput) {
  requireCan(user, "create", "Document");

  const template = await prisma.documentTemplate.findFirst({
    where: { id: input.templateId, companyId: user.companyId },
    include: { fields: true },
  });
  if (!template) throw new Error("Template not found.");

  const leadScope = listScope(user, "Lead") as Prisma.LeadWhereInput;
  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: input.leadId }, leadScope] },
    include: { project: true },
  });
  if (!lead) throw new Error("Lead not found or access denied.");

  const snapshot: Snapshot = {
    pages: (template.pages as unknown as Snapshot["pages"]) ?? [{ width: 612, height: 792 }],
    body: (template.body as unknown as Snapshot["body"]) ?? [],
    sourcePdfKey: template.sourcePdfKey ?? null,
    fields: template.fields.map((f) => ({
      id: f.id,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      type: f.type as SnapshotField["type"],
      signerRole: f.signerRole,
      label: f.label,
      valueToken: f.valueToken,
      defaultValue: f.defaultValue,
    })),
  };

  const tokens: { name: string; email: string | null; raw: string }[] = [];

  const pkg = await prisma.$transaction(async (tx) => {
    const created = await tx.documentPackage.create({
      data: {
        companyId: user.companyId,
        templateId: template.id,
        leadId: lead.id,
        projectId: lead.project?.id ?? null,
        title: template.name,
        status: "sent",
        snapshot: snapshot as unknown as Prisma.InputJsonValue,
        sentAt: new Date(),
        expiresAt: new Date(Date.now() + 1000 * 60 * 60 * 24 * 30),
        createdById: user.userId,
      },
    });

    for (const s of input.signers) {
      const { raw, hash } = generateSignerToken();
      tokens.push({ name: s.name, email: s.email || null, raw });
      await tx.documentSigner.create({
        data: {
          companyId: user.companyId,
          packageId: created.id,
          role: s.role,
          order: s.order,
          name: s.name,
          email: s.email || null,
          status: "sent",
          tokenHash: hash,
        },
      });
    }

    await appendDocumentEvent(tx, {
      companyId: user.companyId,
      packageId: created.id,
      type: "created",
      actor: user.fullName,
    });
    await appendDocumentEvent(tx, {
      companyId: user.companyId,
      packageId: created.id,
      type: "sent",
      actor: user.fullName,
    });
    return created;
  });

  await fireEvent({ companyId: user.companyId, event: "document_sent", actorId: user.userId, documentId: pkg.id, leadId: lead.id });

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const links = tokens.map((t) => ({ name: t.name, url: `${base}/sign/${t.raw}` }));

  // Auto-email the signing link to each signer that has an email (best-effort).
  const company = await prisma.company.findUnique({
    where: { id: user.companyId },
    select: { name: true },
  });
  const companyName = company?.name ?? "Anexa Homes";
  await Promise.all(
    tokens.map(async (t) => {
      if (!t.email) return;
      try {
        await emailSigningLink({
          to: t.email,
          signerName: t.name,
          companyId: user.companyId,
          companyName,
          title: pkg.title,
          url: `${base}/sign/${t.raw}`,
          reminder: false,
        });
      } catch (err) {
        console.error("[esign] send-link email failed", err);
      }
    })
  );

  return { packageId: pkg.id, links };
}

/**
 * Re-issues a fresh signing link for every signer who has not yet signed,
 * invalidating their previous link, emails it to them, and records a
 * `reminder_sent` audit event per signer. Returns the new links for the UI.
 */
export async function resendSignatureRequest(user: SessionUser, packageId: string) {
  requireCan(user, "create", "Document");

  const scope = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;
  const pkg = await prisma.documentPackage.findFirst({
    where: { AND: [{ id: packageId }, scope] },
    include: {
      signers: { orderBy: { order: "asc" } },
      company: { select: { name: true } },
    },
  });
  if (!pkg) throw new Error("Document not found.");
  if (pkg.status === "completed") throw new Error("This document is already completed.");
  if (pkg.status === "voided") throw new Error("This document has been voided.");

  const pending = pkg.signers.filter((s) => s.status !== "signed" && s.status !== "declined");
  if (pending.length === 0) throw new Error("All signers have already signed.");

  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  const links: { name: string; url: string }[] = [];

  for (const signer of pending) {
    const { raw, hash } = generateSignerToken();
    await prisma.documentSigner.update({ where: { id: signer.id }, data: { tokenHash: hash } });
    const url = `${base}/sign/${raw}`;
    links.push({ name: signer.name, url });

    await appendDocumentEvent(prisma, {
      companyId: pkg.companyId,
      packageId: pkg.id,
      type: "reminder_sent",
      signerId: signer.id,
      actor: user.fullName,
    });

    if (signer.email) {
      try {
        await emailSigningLink({
          to: signer.email,
          signerName: signer.name,
          companyId: pkg.companyId,
          companyName: pkg.company.name,
          title: pkg.title,
          url,
          reminder: true,
        });
      } catch (err) {
        console.error("[esign] reminder email failed", err);
      }
    }
  }

  return { links };
}

// ---------------------------------------------------------------------------
// View / sign
// ---------------------------------------------------------------------------

// Shared include so view + generate fetch every field the autofill context needs.
const LEAD_CTX_INCLUDE = {
  source: { select: { name: true } },
  assignedRep: { select: { firstName: true, lastName: true } },
  project: {
    select: {
      projectNumber: true,
      serviceType: true,
      status: true,
      contractValue: true,
      customFields: true,
      manager: { select: { firstName: true, lastName: true } },
    },
  },
} as const;

type LeadForCtx = {
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  status: string;
  createdAt: Date;
  customFields: unknown;
  source: { name: string } | null;
  assignedRep: { firstName: string; lastName: string } | null;
  project: {
    projectNumber: string;
    serviceType: string;
    status: string;
    contractValue: number;
    customFields: unknown;
    manager: { firstName: string; lastName: string } | null;
  } | null;
};

function ctxForLead(lead: LeadForCtx, companyName: string): AutofillContext {
  const custom: Record<string, string> = {};
  const merge = (obj: unknown) => {
    if (obj && typeof obj === "object") {
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) custom[k] = v == null ? "" : String(v);
    }
  };
  merge(lead.customFields);
  merge(lead.project?.customFields);
  const name = (u: { firstName: string; lastName: string } | null | undefined) =>
    u ? `${u.firstName} ${u.lastName}`.trim() : null;
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

export type SigningState = "active" | "completed" | "voided" | "expired" | "already_signed" | "waiting";

export async function getViewByToken(rawToken: string) {
  const signer = await prisma.documentSigner.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: {
      package: {
        include: {
          company: { select: { name: true } },
          lead: { include: LEAD_CTX_INCLUDE },
          signers: { orderBy: { order: "asc" } },
        },
      },
    },
  });
  if (!signer) return null;

  const pkg = signer.package;
  const snapshot = pkg.snapshot as unknown as Snapshot;
  const ctx = pkg.lead ? ctxForLead(pkg.lead, pkg.company.name) : null;
  const signerFields = (snapshot.fields ?? []).filter((f) => f.signerRole === signer.role);

  let state: SigningState = "active";
  if (pkg.status === "voided") state = "voided";
  else if (pkg.status === "completed") state = "completed";
  else if (pkg.expiresAt && pkg.expiresAt < new Date()) state = "expired";
  else if (signer.status === "signed") state = "already_signed";
  else {
    const priorUnsigned = pkg.signers.some((s) => s.order < signer.order && s.status !== "signed");
    if (priorUnsigned) state = "waiting";
  }

  // Record a view (best-effort) the first time.
  if (state === "active" && signer.status !== "viewed") {
    await prisma.documentSigner.update({
      where: { id: signer.id },
      data: { status: "viewed", viewedAt: signer.viewedAt ?? new Date() },
    });
    await appendDocumentEvent(prisma, {
      companyId: pkg.companyId,
      packageId: pkg.id,
      type: "viewed",
      signerId: signer.id,
      actor: signer.name,
    });
    await fireEvent({ companyId: pkg.companyId, event: "document_viewed", documentId: pkg.id, leadId: pkg.leadId });
  }

  return {
    state,
    signerId: signer.id,
    signerName: signer.name,
    signerRole: signer.role,
    title: pkg.title,
    snapshot,
    ctx,
    signerFields,
    signedFileId: pkg.signedFileId,
  };
}

export type SignSubmit = {
  consent: boolean;
  signatureType: "typed" | "drawn";
  values: Record<string, string>; // fieldId -> value
  // Optional geolocation, only present if the signer granted browser permission.
  geo?: { latitude: number; longitude: number; accuracy: number } | null;
};

export async function recordSignatureByToken(
  rawToken: string,
  input: SignSubmit,
  meta: { ip: string | null; userAgent: string | null }
): Promise<{ ok: boolean; error?: string; completed?: boolean }> {
  if (!input.consent) return { ok: false, error: "You must consent to use electronic signatures." };

  const signer = await prisma.documentSigner.findUnique({
    where: { tokenHash: sha256(rawToken) },
    include: { package: { include: { signers: true } } },
  });
  if (!signer) return { ok: false, error: "Invalid signing link." };

  const pkg = signer.package;
  if (pkg.status === "voided") return { ok: false, error: "This document has been voided." };
  if (pkg.status === "completed" || signer.status === "signed")
    return { ok: false, error: "This document has already been signed." };
  if (pkg.expiresAt && pkg.expiresAt < new Date())
    return { ok: false, error: "This signing link has expired." };

  // Sequential signing enforcement.
  const priorUnsigned = pkg.signers.some((s) => s.order < signer.order && s.status !== "signed");
  if (priorUnsigned) return { ok: false, error: "A previous signer must sign first." };

  // Server-side field validation: only fields assigned to this signer's role.
  const snapshot = pkg.snapshot as unknown as Snapshot;
  const allowed = new Map(
    (snapshot.fields ?? []).filter((f) => f.signerRole === signer.role).map((f) => [f.id, f])
  );
  for (const f of allowed.values()) {
    const v = input.values[f.id];
    if (f.type === "signature" || f.type === "initials") {
      if (!v || !v.startsWith("data:image")) {
        return { ok: false, error: "Please provide your signature." };
      }
    }
  }

  await prisma.$transaction(async (tx) => {
    for (const [fieldId, field] of allowed) {
      const value = input.values[fieldId] ?? (field.type === "checkbox" ? "false" : "");
      await tx.documentFieldValue.create({
        data: {
          packageId: pkg.id,
          signerId: signer.id,
          fieldKey: fieldId,
          type: field.type,
          page: field.page,
          x: field.x,
          y: field.y,
          width: field.width,
          height: field.height,
          value,
          filledAt: new Date(),
        },
      });
    }

    const sigField = Array.from(allowed.values()).find((f) => f.type === "signature" || f.type === "initials");
    const signatureData = sigField ? input.values[sigField.id] : null;

    await tx.documentSigner.update({
      where: { id: signer.id },
      data: {
        status: "signed",
        signatureType: input.signatureType,
        signatureData: signatureData ?? null,
        consentAt: new Date(),
        signedAt: new Date(),
        ip: meta.ip,
        userAgent: meta.userAgent,
        latitude: input.geo?.latitude ?? null,
        longitude: input.geo?.longitude ?? null,
        geoAccuracy: input.geo?.accuracy ?? null,
      },
    });

    await appendDocumentEvent(tx, {
      companyId: pkg.companyId,
      packageId: pkg.id,
      type: "signed",
      signerId: signer.id,
      actor: signer.name,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
  });

  await fireEvent({ companyId: pkg.companyId, event: "document_signed", documentId: pkg.id, leadId: pkg.leadId });

  // Finalize if all signed.
  const remaining = await prisma.documentSigner.count({
    where: { packageId: pkg.id, status: { not: "signed" } },
  });

  if (remaining === 0) {
    await finalizePackage(pkg.id);
    return { ok: true, completed: true };
  }

  // Otherwise mark partially signed.
  await prisma.documentPackage.update({
    where: { id: pkg.id },
    data: { status: "partially_signed" },
  });
  return { ok: true, completed: false };
}

async function finalizePackage(packageId: string) {
  const pkg = await prisma.documentPackage.findUnique({
    where: { id: packageId },
    include: {
      company: { select: { name: true } },
      lead: { include: LEAD_CTX_INCLUDE },
      signers: { orderBy: { order: "asc" } },
      values: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!pkg || !pkg.lead) return;

  const snapshot = pkg.snapshot as unknown as Snapshot;
  const ctx = ctxForLead(pkg.lead, pkg.company.name);

  const values: Record<string, FilledValue> = {};
  for (const v of pkg.values) {
    values[v.fieldKey] = { value: v.value ?? "", type: v.type as FilledValue["type"] };
  }

  let sourcePdf: Buffer | null = null;
  if (snapshot.sourcePdfKey) {
    try {
      sourcePdf = await getObject(snapshot.sourcePdfKey);
    } catch {
      sourcePdf = null;
    }
  }

  const buffer = await generateSignedPdf({
    title: pkg.title,
    snapshot,
    ctx,
    values,
    sourcePdf,
    documentId: pkg.id,
    completedAt: new Date(),
    signers: pkg.signers.map((s) => ({
      name: s.name, email: s.email, signedAt: s.signedAt, ip: s.ip, role: s.role, status: s.status,
      userAgent: s.userAgent, consentAt: s.consentAt, viewedAt: s.viewedAt,
      latitude: s.latitude, longitude: s.longitude, geoAccuracy: s.geoAccuracy,
    })),
    events: pkg.events.map((e) => ({
      type: e.type,
      actor: e.actor,
      ip: e.ip,
      createdAt: e.createdAt,
      metadata: e.metadata,
    })),
  });

  const key = `companies/${pkg.companyId}/documents/${pkg.id}.pdf`;
  await putObject(key, buffer);

  await prisma.$transaction(async (tx) => {
    const file = await tx.fileAsset.create({
      data: {
        companyId: pkg.companyId,
        kind: "signed_document",
        name: `${pkg.title}.pdf`,
        storageKey: key,
        mimeType: "application/pdf",
        size: buffer.length,
        category: "signed_contract",
        leadId: pkg.leadId,
        projectId: pkg.projectId,
      },
    });
    await tx.documentPackage.update({
      where: { id: pkg.id },
      data: { status: "completed", completedAt: new Date(), signedFileId: file.id },
    });
    await appendDocumentEvent(tx, {
      companyId: pkg.companyId,
      packageId: pkg.id,
      type: "completed",
      data: { fileId: file.id, sha256: sha256(buffer.toString("base64")) },
    });
  });

  await fireEvent({ companyId: pkg.companyId, event: "document_completed", documentId: pkg.id, leadId: pkg.leadId });
}

export async function voidPackage(user: SessionUser, packageId: string, reason?: string) {
  requireCan(user, "update", "Document");
  const pkg = await prisma.documentPackage.findFirst({
    where: { id: packageId, companyId: user.companyId },
  });
  if (!pkg) throw new Error("Document not found.");
  if (pkg.status === "completed") throw new Error("Completed documents cannot be voided.");

  await prisma.documentPackage.update({
    where: { id: pkg.id },
    data: { status: "voided", voidedAt: new Date() },
  });
  await appendDocumentEvent(prisma, {
    companyId: user.companyId,
    packageId: pkg.id,
    type: "voided",
    actor: user.fullName,
    data: { reason: reason ?? null },
  });
}

/** For an authenticated owner (customer): rotate their signer token and return the signing URL. */
export async function getSigningLinkForUser(user: SessionUser, packageId: string): Promise<string | null> {
  const signer = await prisma.documentSigner.findFirst({
    where: {
      packageId,
      companyId: user.companyId,
      OR: [
        { email: user.email ?? "__none__" },
        { package: { lead: { customerUserId: user.userId } }, role: "customer" },
      ],
    },
  });
  if (!signer) return null;
  const { raw, hash } = generateSignerToken();
  await prisma.documentSigner.update({ where: { id: signer.id }, data: { tokenHash: hash } });
  const base = process.env.NEXT_PUBLIC_APP_URL ?? "";
  return `${base}/sign/${raw}`;
}

// ---------------------------------------------------------------------------
// On-demand PDF generation (preview without/with signing)
// ---------------------------------------------------------------------------

/**
 * Render a document package's PDF as it currently stands — auto-filled from the
 * CRM plus any signatures captured so far. Lets staff "Generate PDF" to see the
 * filled document instead of only sending it to the customer.
 */
export async function generatePackagePdf(
  user: SessionUser,
  packageId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const scope = listScope(user, "Document") as Prisma.DocumentPackageWhereInput;
  const pkg = await prisma.documentPackage.findFirst({
    where: { AND: [{ id: packageId }, scope] },
    include: {
      company: { select: { name: true } },
      lead: { include: LEAD_CTX_INCLUDE },
      signers: { orderBy: { order: "asc" } },
      values: true,
      events: { orderBy: { createdAt: "asc" } },
    },
  });
  if (!pkg || !pkg.lead) return null;

  const snapshot = pkg.snapshot as unknown as Snapshot;
  const ctx = ctxForLead(pkg.lead, pkg.company.name);
  const values: Record<string, FilledValue> = {};
  for (const v of pkg.values) values[v.fieldKey] = { value: v.value ?? "", type: v.type as FilledValue["type"] };

  let sourcePdf: Buffer | null = null;
  if (snapshot.sourcePdfKey) {
    try {
      sourcePdf = await getObject(snapshot.sourcePdfKey);
    } catch {
      sourcePdf = null;
    }
  }

  const buffer = await generateSignedPdf({
    title: pkg.title,
    snapshot,
    ctx,
    values,
    sourcePdf,
    signers: pkg.signers.map((s) => ({ name: s.name, email: s.email, signedAt: s.signedAt, ip: s.ip })),
    events: pkg.events.map((e) => ({ type: e.type, actor: e.actor, ip: e.ip, createdAt: e.createdAt, metadata: e.metadata })),
  });
  return { buffer, filename: `${pkg.title.replace(/[^a-z0-9]+/gi, "_")}.pdf` };
}

// A realistic sample record so a template preview shows what an auto-filled,
// signed document will look like.
function sampleCtx(companyName: string): AutofillContext {
  return buildAutofillContext({
    firstName: "Nancy",
    lastName: "Moore",
    email: "nancy@example.com",
    phone: "(555) 123-4567",
    street: "107 Oak Street",
    city: "Dallas",
    state: "TX",
    zip: "75201",
    projectNumber: "AH-1004",
    projectType: "roofing",
    projectStage: "in_production",
    projectValueCents: 2300000,
    rep: "Tyler Brooks",
    pm: "Sofia Nguyen",
    leadSource: "Referral",
    leadCreatedAt: new Date(),
    leadStatus: "open",
    companyName,
    custom: {},
  });
}

/**
 * Render a TEMPLATE as a filled PDF using sample data — so staff can preview how
 * the finished contract will look (auto-fill placed, signatures shown as samples)
 * straight from the template editor.
 */
export async function generateTemplatePreviewPdf(
  user: SessionUser,
  templateId: string
): Promise<{ buffer: Buffer; filename: string } | null> {
  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, companyId: user.companyId },
    include: { fields: true, company: { select: { name: true } } },
  });
  if (!template) return null;

  const snapshot: Snapshot = {
    pages: (template.pages as unknown as Snapshot["pages"]) ?? [],
    body: (template.body as unknown as Snapshot["body"]) ?? [],
    sourcePdfKey: template.sourcePdfKey ?? null,
    fields: template.fields.map((f) => ({
      id: f.id,
      page: f.page,
      x: f.x,
      y: f.y,
      width: f.width,
      height: f.height,
      type: f.type as SnapshotField["type"],
      signerRole: f.signerRole,
      label: f.label,
      valueToken: f.valueToken,
      defaultValue: f.defaultValue,
    })),
  };

  const ctx = sampleCtx(template.company.name);
  // Sample values for fields the signer would fill, so the preview isn't blank.
  const values: Record<string, FilledValue> = {};
  for (const f of template.fields) {
    if (f.type === "signature") values[f.id] = { value: ctx.customer.fullName, type: "signature" };
    else if (f.type === "initials") values[f.id] = { value: `${ctx.customer.firstName[0]}${ctx.customer.lastName[0]}`, type: "initials" };
    else if (f.type === "date" && !f.valueToken) values[f.id] = { value: ctx.today, type: "date" };
  }

  let sourcePdf: Buffer | null = null;
  if (template.sourcePdfKey) {
    try {
      sourcePdf = await getObject(template.sourcePdfKey);
    } catch {
      sourcePdf = null;
    }
  }

  const buffer = await generateSignedPdf({
    title: template.name,
    snapshot,
    ctx,
    values,
    sourcePdf,
    signers: [],
    events: [],
    certificate: false, // a preview — no audit certificate page
  });
  return { buffer, filename: `${template.name.replace(/[^a-z0-9]+/gi, "_")}-preview.pdf` };
}
