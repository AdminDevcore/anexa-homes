"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { requireCan, can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { putObject } from "@/server/storage";
import { packageDestinations } from "@/lib/deal-folders";
import { finalPacketTemplates } from "./final-docs";
import {
  sendForSignature,
  resendSignatureRequest,
  recordSignatureByToken,
  voidPackage,
  getSigningLinkForUser,
  getInPersonSigningLink,
  type SendInput,
  type SignSubmit,
} from "./service";

async function clientMeta() {
  const h = await headers();
  const fwd = h.get("x-forwarded-for");
  const ip = fwd ? fwd.split(",")[0].trim() : h.get("x-real-ip");
  return { ip: ip ?? null, userAgent: h.get("user-agent") ?? null };
}

const sendSchema = z.object({
  templateId: z.string().uuid(),
  leadId: z.string().uuid(),
  signers: z
    .array(
      z.object({
        role: z.enum(["customer", "co_customer", "company_rep", "witness"]),
        name: z.string().min(1),
        email: z.string().email().optional().or(z.literal("")),
        order: z.number().int().min(1),
      })
    )
    .min(1),
});

/** One template, one envelope — the Documents page's own send dialog. */
export type SendDocumentInput = z.infer<typeof sendSchema>;

export async function sendDocumentAction(input: SendDocumentInput) {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Please complete all signer fields." };
  try {
    const result = await sendForSignature(user, {
      templateIds: [parsed.data.templateId],
      leadId: parsed.data.leadId,
      signers: parsed.data.signers as SendInput["signers"],
    });
    revalidatePath("/portal/documents");
    return { ok: true as const, ...result };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to send." };
  }
}

const sendManySchema = z.object({
  leadId: z.string().uuid(),
  templateIds: z.array(z.string().uuid()).min(1),
  signers: sendSchema.shape.signers,
});

export type SendDocumentsInput = z.infer<typeof sendManySchema>;

/**
 * Send the checked templates to a deal as ONE envelope — the proposal's
 * "Send docs".
 *
 * They used to go out one envelope per template, which meant an email and a
 * signature per document for a customer who was buying one job. Now they are
 * concatenated into a single package: one link, one signature, one merged PDF
 * on the deal, in the order they were checked.
 *
 * That makes the send all-or-nothing, where it used to report per template. It
 * has to be: an envelope is one signature, so there is no half of it to
 * deliver. A template that cannot go (no PDF uploaded, say) fails the send and
 * says which one, rather than quietly sending the rest.
 */
export async function sendDocumentsAction(input: SendDocumentsInput) {
  const user = await requireUser();
  const parsed = sendManySchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Choose at least one document and a signer." };

  try {
    const result = await sendForSignature(user, {
      templateIds: parsed.data.templateIds,
      leadId: parsed.data.leadId,
      signers: parsed.data.signers as SendInput["signers"],
    });
    revalidatePath("/portal/documents");
    revalidatePath(`/portal/leads/${parsed.data.leadId}`);
    return {
      ok: true as const,
      packageId: result.packageId,
      title: result.title,
      links: result.links,
    };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to send." };
  }
}

/**
 * Send the closeout packet to the homeowner — the deal's "Send final docs to
 * customer".
 *
 * The packet is not chosen here and not chosen on the job: it is whichever
 * templates carry `finalPacket`, so the person standing on a finished install
 * taps once and the right paperwork goes. Everything goes as ONE envelope, for
 * the same reason `sendDocumentsAction` does — a customer closing one job
 * should sign once.
 *
 * The customer is the only signer. `Lead` stores `coOwnerName` but no co-owner
 * email, so there is no second address to send to; this is the same rule the
 * `send_for_signature` automation action follows, and the reason a rule you
 * write in Settings and this button produce the same envelope.
 *
 * Authorisation is `sendForSignature`'s: `requireCan(create, Document)` plus
 * the lead scope. The lookup below is scoped too, so a deal outside the
 * viewer's scope is "not found" here rather than leaking a name into an error.
 */
export async function sendFinalDocsAction(leadId: string) {
  const user = await requireUser();
  if (!can(user, "create", "Document")) return { ok: false as const, error: "Not allowed." };

  const lead = await prisma.lead.findFirst({
    where: { AND: [{ id: leadId }, listScope(user, "Lead") as Prisma.LeadWhereInput] },
    select: { id: true, firstName: true, lastName: true, email: true },
  });
  if (!lead) return { ok: false as const, error: "Deal not found." };

  const email = lead.email?.trim();
  // A signature request with no address is a document sent nowhere. Refused
  // rather than sent, for the reason the automation action refuses it too.
  if (!email) return { ok: false as const, error: "This deal has no email address on file." };

  const templates = await finalPacketTemplates(user.companyId);
  if (templates.length === 0) {
    return {
      ok: false as const,
      error: "No documents are marked as final documents yet.",
    };
  }

  try {
    const result = await sendForSignature(user, {
      templateIds: templates.map((t) => t.id),
      leadId: lead.id,
      signers: [
        {
          role: "customer",
          name: `${lead.firstName} ${lead.lastName}`.trim(),
          email,
          order: 1,
        },
      ],
    });
    revalidatePath(`/portal/leads/${lead.id}`);
    revalidatePath("/portal/documents");
    return { ok: true as const, packageId: result.packageId, title: result.title };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to send." };
  }
}

export async function resendDocumentAction(packageId: string) {
  const user = await requireUser();
  try {
    const result = await resendSignatureRequest(user, packageId);
    revalidatePath("/portal/documents");
    revalidatePath(`/portal/documents/${packageId}`);
    return { ok: true as const, ...result };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to resend." };
  }
}

export async function submitSignatureByTokenAction(rawToken: string, input: SignSubmit) {
  const meta = await clientMeta();
  return recordSignatureByToken(rawToken, input, meta);
}

export async function voidDocumentAction(packageId: string, reason?: string) {
  const user = await requireUser();
  try {
    await voidPackage(user, packageId, reason);
    revalidatePath(`/portal/documents/${packageId}`);
    revalidatePath("/portal/documents");
    return { ok: true as const };
  } catch (e) {
    return { ok: false as const, error: e instanceof Error ? e.message : "Failed to void." };
  }
}

export async function openSigningForOwnerAction(packageId: string) {
  const user = await requireUser();
  const url = await getSigningLinkForUser(user, packageId);
  if (!url) return { ok: false as const, error: "No signing slot for your account." };
  return { ok: true as const, url };
}

/**
 * Rep hands their device to a customer to sign in person. Rotates the target
 * signer's token and returns a fresh /sign link to open right on this device —
 * no email required. Only staff who can send documents may do this.
 */
export async function openInPersonSigningAction(packageId: string, signerId?: string) {
  const user = await requireUser();
  if (!can(user, "create", "Document")) return { ok: false as const, error: "Not allowed." };
  const res = await getInPersonSigningLink(user, packageId, signerId);
  if ("error" in res) return { ok: false as const, error: res.error };
  return { ok: true as const, url: res.url, signerName: res.signerName };
}

// --- Template field editor ---

const fieldSchema = z.object({
  page: z.number().int().min(1),
  x: z.number(),
  y: z.number(),
  width: z.number().min(8),
  height: z.number().min(8),
  type: z.enum(["text", "date", "checkbox", "signature", "initials"]),
  signerRole: z.enum(["customer", "co_customer", "company_rep", "witness"]),
  label: z.string().optional().or(z.literal("")),
  valueToken: z.string().optional().or(z.literal("")),
  defaultValue: z.string().optional().or(z.literal("")),
  required: z.boolean().optional(),
  // Which PDF in the bundle the field sits on. Null/absent = the template's own
  // PDF, which is every single-document template.
  documentId: z.string().uuid().nullable().optional(),
});

const saveFieldsSchema = z.object({
  templateId: z.string().uuid(),
  fields: z.array(fieldSchema),
});

export async function saveTemplateFieldsAction(input: z.infer<typeof saveFieldsSchema>) {
  const user = await requireUser();
  requireCan(user, "update", "Document");
  const parsed = saveFieldsSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Invalid fields." };

  const template = await prisma.documentTemplate.findFirst({
    where: { id: parsed.data.templateId, companyId: user.companyId },
    select: { id: true, documents: { select: { id: true }, orderBy: { order: "asc" } } },
  });
  if (!template) return { ok: false as const, error: "Template not found." };

  // A documentId from another template would pass the FK and silently attach a
  // field to a document this template does not own, so anything unrecognised
  // falls back rather than being trusted.
  //
  // The fallback is DOCUMENT 1, not NULL, whenever the template has documents.
  // The editor holds fields in state across a save, so a field placed before a
  // template was split still carries no documentId when it is next saved —
  // writing NULL there would drop it from the envelope entirely, sending a
  // contract with no signature box on its first document. Document 1 is also
  // exactly where the editor has been showing it.
  const ownDocs = new Set(template.documents.map((d) => d.id));
  const firstDocId = template.documents[0]?.id ?? null;

  await prisma.$transaction([
    prisma.documentTemplateField.deleteMany({ where: { templateId: template.id } }),
    prisma.documentTemplateField.createMany({
      data: parsed.data.fields.map((f) => ({
        templateId: template.id,
        documentId: f.documentId && ownDocs.has(f.documentId) ? f.documentId : firstDocId,
        page: f.page,
        x: f.x,
        y: f.y,
        width: f.width,
        height: f.height,
        type: f.type,
        signerRole: f.signerRole,
        label: f.label || null,
        valueToken: f.valueToken || null,
        defaultValue: f.defaultValue || null,
        required: f.required ?? true,
      })),
    }),
  ]);

  revalidatePath(`/portal/documents/templates/${template.id}`);
  return { ok: true as const };
}

export async function uploadTemplatePdfAction(formData: FormData) {
  const user = await requireUser();
  requireCan(user, "update", "Document");

  const templateId = formData.get("templateId") as string;
  // Present once a template holds more than one PDF: the upload replaces THAT
  // document rather than the template's own source.
  const documentId = (formData.get("documentId") as string | null) || null;
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "No file provided." };
  if (file.type !== "application/pdf") return { ok: false as const, error: "Please upload a PDF." };
  if (file.size > 25 * 1024 * 1024) return { ok: false as const, error: "PDF too large (max 25MB)." };

  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, companyId: user.companyId },
    select: { id: true },
  });
  if (!template) return { ok: false as const, error: "Template not found." };

  const target = documentId
    ? await prisma.documentTemplateDocument.findFirst({
        where: { id: documentId, templateId: template.id },
        select: { id: true },
      })
    : null;
  if (documentId && !target) return { ok: false as const, error: "Document not found." };

  const buffer = Buffer.from(await file.arrayBuffer());
  let pages: { width: number; height: number }[];
  try {
    const pdf = await PDFDocument.load(buffer);
    pages = pdf.getPages().map((p) => {
      const { width, height } = p.getSize();
      return { width, height };
    });
  } catch {
    return { ok: false as const, error: "Could not read that PDF." };
  }
  if (pages.length === 0) return { ok: false as const, error: "PDF has no pages." };

  const key = target
    ? `companies/${user.companyId}/templates/${templateId}/${target.id}.pdf`
    : `companies/${user.companyId}/templates/${templateId}.pdf`;
  await putObject(key, buffer);

  if (target) {
    await prisma.documentTemplateDocument.update({
      where: { id: target.id },
      data: { sourcePdfKey: key, pages: pages as unknown as Prisma.InputJsonValue },
    });
  } else {
    await prisma.documentTemplate.update({
      where: { id: templateId },
      data: { sourcePdfKey: key, pages: pages as unknown as Prisma.InputJsonValue, body: [] },
    });
  }

  revalidatePath(`/portal/documents/templates/${templateId}`);
  return { ok: true as const, pages: pages.length };
}

// --- Documents inside a template ---
//
// A template is a LIST of PDFs. The rows only appear once a second document is
// added: until then the template's own sourcePdfKey IS the document, which is
// how every template that predates this keeps working untouched.

async function ownedTemplate(companyId: string, templateId: string) {
  return prisma.documentTemplate.findFirst({
    where: { id: templateId, companyId },
    select: { id: true, name: true, sourcePdfKey: true, pages: true },
  });
}

async function ownedDocument(companyId: string, documentId: string) {
  return prisma.documentTemplateDocument.findFirst({
    where: { id: documentId, template: { companyId } },
    select: { id: true, templateId: true, name: true },
  });
}

/**
 * Add a PDF slot to a template.
 *
 * The first call on a legacy template does the migration the schema cannot: it
 * materialises the template's existing PDF as document 1 and adopts the fields
 * already placed on it, THEN adds the empty slot. Skipping that step would
 * leave those fields with a NULL documentId in a template that now has rows,
 * where `buildSnapshotFromTemplate` would drop them — the contract would send
 * with no signature boxes.
 */
export async function addTemplateDocumentAction(input: { templateId: string; name?: string }) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };

  const template = await ownedTemplate(user.companyId, input.templateId);
  if (!template) return { ok: false as const, error: "Template not found." };

  const existing = await prisma.documentTemplateDocument.count({ where: { templateId: template.id } });

  const created = await prisma.$transaction(async (tx) => {
    let count = existing;
    if (count === 0) {
      const primary = await tx.documentTemplateDocument.create({
        data: {
          templateId: template.id,
          order: 1,
          name: template.name || "Document 1",
          sourcePdfKey: template.sourcePdfKey,
          pages: (template.pages ?? []) as Prisma.InputJsonValue,
        },
        select: { id: true },
      });
      await tx.documentTemplateField.updateMany({
        where: { templateId: template.id, documentId: null },
        data: { documentId: primary.id },
      });
      count = 1;
    }
    return tx.documentTemplateDocument.create({
      data: {
        templateId: template.id,
        order: count + 1,
        name: input.name?.trim() || `Document ${count + 1}`,
        pages: [] as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
  });

  revalidatePath(`/portal/documents/templates/${template.id}`);
  return { ok: true as const, id: created.id };
}

export async function renameTemplateDocumentAction(input: { documentId: string; name: string }) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };
  const name = input.name.trim();
  if (!name) return { ok: false as const, error: "Name is required." };
  if (name.length > 120) return { ok: false as const, error: "Name is too long." };

  const doc = await ownedDocument(user.companyId, input.documentId);
  if (!doc) return { ok: false as const, error: "Document not found." };

  await prisma.documentTemplateDocument.update({ where: { id: doc.id }, data: { name } });
  revalidatePath(`/portal/documents/templates/${doc.templateId}`);
  return { ok: true as const };
}

/**
 * Remove a document from the bundle. Its fields go with it (FK cascade).
 *
 * Deleting down to one document does NOT collapse back to the legacy shape —
 * the surviving row stays, keeping its own name and PDF. Nothing reads the two
 * shapes differently, so there is no reason to rewrite history.
 */
export async function deleteTemplateDocumentAction(input: { documentId: string }) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };

  const doc = await ownedDocument(user.companyId, input.documentId);
  if (!doc) return { ok: false as const, error: "Document not found." };

  const remaining = await prisma.documentTemplateDocument.count({ where: { templateId: doc.templateId } });
  if (remaining <= 1) return { ok: false as const, error: "A template needs at least one document." };

  await prisma.$transaction(async (tx) => {
    await tx.documentTemplateDocument.delete({ where: { id: doc.id } });
    // Close the gap so `order` stays 1..n and the bundle reads in sequence.
    const rest = await tx.documentTemplateDocument.findMany({
      where: { templateId: doc.templateId },
      orderBy: { order: "asc" },
      select: { id: true },
    });
    for (const [i, d] of rest.entries()) {
      await tx.documentTemplateDocument.update({ where: { id: d.id }, data: { order: i + 1 } });
    }
  });

  revalidatePath(`/portal/documents/templates/${doc.templateId}`);
  return { ok: true as const };
}

/** Reorder the bundle. `orderedIds` must name every document in the template. */
export async function reorderTemplateDocumentsAction(input: { templateId: string; orderedIds: string[] }) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };

  const template = await ownedTemplate(user.companyId, input.templateId);
  if (!template) return { ok: false as const, error: "Template not found." };

  const docs = await prisma.documentTemplateDocument.findMany({
    where: { templateId: template.id },
    select: { id: true },
  });
  const own = new Set(docs.map((d) => d.id));
  // A partial or foreign list would leave documents sharing an order, and the
  // bundle would assemble in an arbitrary sequence — so reject it outright.
  if (input.orderedIds.length !== docs.length || input.orderedIds.some((id) => !own.has(id))) {
    return { ok: false as const, error: "Invalid document order." };
  }

  await prisma.$transaction(
    input.orderedIds.map((id, i) =>
      prisma.documentTemplateDocument.update({ where: { id }, data: { order: i + 1 } }),
    ),
  );

  revalidatePath(`/portal/documents/templates/${template.id}`);
  return { ok: true as const };
}

const updateTemplateSchema = z.object({
  id: z.string().uuid(),
  name: z.string().trim().min(1, "Name is required.").max(120),
  // "" from an unset <select> means "no destination", which is Contract.
  folderKey: z.string().optional().or(z.literal("")),
  // Whether this document travels with the closeout packet the deal's "Send
  // final docs to customer" sends. Optional so a caller that predates the
  // control leaves the flag as it found it.
  finalPacket: z.boolean().optional(),
});

/**
 * Rename a template and choose where its signed document files.
 *
 * The name was previously unreachable: templates were created as "Untitled
 * contract" and nothing ever wrote the column, so every template — and every
 * package, which takes its title from here — carried the placeholder. Four
 * documents that are all called "Untitled contract" cannot be told apart, let
 * alone routed, so renaming ships with the routing that needs it.
 */
export async function updateTemplateAction(input: z.infer<typeof updateTemplateSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };
  const parsed = updateTemplateSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false as const, error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  const template = await prisma.documentTemplate.findFirst({
    where: { id: parsed.data.id, companyId: user.companyId },
    select: { id: true, vertical: true },
  });
  if (!template) return { ok: false as const, error: "Template not found." };

  // The destination must be a real folder for THIS template's vertical, or an
  // arbitrary string reaches the column and the document files nowhere. Same
  // guard moveFileAction applies to a file's category.
  const folderKey = parsed.data.folderKey || null;
  if (folderKey && !packageDestinations(template.vertical).some((f) => f.key === folderKey)) {
    return { ok: false as const, error: "Unknown folder." };
  }

  // The packet is a solar idea: only the solar deal page sends one, and only
  // solar's editor offers the control. Ignoring the flag on a roofing template
  // means a stray payload cannot put roofing paperwork in a packet nothing
  // sends.
  const finalPacket =
    template.vertical === "solar" && parsed.data.finalPacket !== undefined
      ? { finalPacket: parsed.data.finalPacket }
      : {};

  await prisma.documentTemplate.update({
    where: { id: template.id },
    data: { name: parsed.data.name, folderKey, ...finalPacket },
  });

  revalidatePath("/portal/documents");
  revalidatePath(`/portal/documents/templates/${template.id}`);
  return { ok: true as const };
}

/** Create a blank contract template in the active vertical workspace; returns its id. */
export async function createTemplateAction() {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };
  const vertical = await getActiveVertical(user);
  const t = await prisma.documentTemplate.create({
    data: { companyId: user.companyId, name: "Untitled contract", type: "custom", vertical, active: true },
    select: { id: true },
  });
  revalidatePath("/portal/documents");
  return { ok: true as const, id: t.id };
}

/**
 * Delete a document template. Already-sent packages keep their snapshot of the
 * template body + fields (their templateId just nulls out), so sent documents are
 * unaffected.
 */
export async function deleteTemplateAction(id: string) {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };
  const t = await prisma.documentTemplate.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!t) return { ok: false as const, error: "Template not found." };
  await prisma.documentTemplate.delete({ where: { id } });
  revalidatePath("/portal/documents");
  return { ok: true as const };
}
