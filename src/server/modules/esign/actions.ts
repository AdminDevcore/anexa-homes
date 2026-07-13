"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PDFDocument } from "pdf-lib";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { requireCan, can } from "@/server/rbac/guards";
import { getActiveIndustry } from "@/server/auth/industry";
import { putObject } from "@/server/storage";
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

export async function sendDocumentAction(input: SendInput) {
  const user = await requireUser();
  const parsed = sendSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Please complete all signer fields." };
  try {
    const result = await sendForSignature(user, parsed.data as SendInput);
    revalidatePath("/portal/documents");
    return { ok: true as const, ...result };
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
    select: { id: true },
  });
  if (!template) return { ok: false as const, error: "Template not found." };

  await prisma.$transaction([
    prisma.documentTemplateField.deleteMany({ where: { templateId: template.id } }),
    prisma.documentTemplateField.createMany({
      data: parsed.data.fields.map((f) => ({
        templateId: template.id,
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
  const file = formData.get("file");
  if (!(file instanceof File)) return { ok: false as const, error: "No file provided." };
  if (file.type !== "application/pdf") return { ok: false as const, error: "Please upload a PDF." };
  if (file.size > 25 * 1024 * 1024) return { ok: false as const, error: "PDF too large (max 25MB)." };

  const template = await prisma.documentTemplate.findFirst({
    where: { id: templateId, companyId: user.companyId },
    select: { id: true },
  });
  if (!template) return { ok: false as const, error: "Template not found." };

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

  const key = `companies/${user.companyId}/templates/${templateId}.pdf`;
  await putObject(key, buffer);

  await prisma.documentTemplate.update({
    where: { id: templateId },
    data: { sourcePdfKey: key, pages: pages as unknown as Prisma.InputJsonValue, body: [] },
  });

  revalidatePath(`/portal/documents/templates/${templateId}`);
  return { ok: true as const, pages: pages.length };
}

/** Create a blank contract template in the active industry workspace; returns its id. */
export async function createTemplateAction() {
  const user = await requireUser();
  if (!can(user, "update", "Document")) return { ok: false as const, error: "Not allowed." };
  const industry = await getActiveIndustry(user);
  const t = await prisma.documentTemplate.create({
    data: { companyId: user.companyId, name: "Untitled contract", type: "custom", industry, active: true },
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
