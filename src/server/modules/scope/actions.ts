"use server";

import { revalidatePath } from "next/cache";
import { nanoid } from "nanoid";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { putObject } from "@/server/storage";
import { canSeeScopeCosts } from "./policies";

type Result = { ok: true } | { ok: false; error: string };
type ScopeResult = { ok: true; scopeId: string } | { ok: false; error: string };

const MAX_PDF_BYTES = 30 * 1024 * 1024;
const PDF_ALLOWED = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "scope.pdf";
}

/** Verify the user may access this lead (tenant + row scope). */
async function leadAccessible(userId: string, companyId: string, role: string, leadId: string) {
  const scope = listScope({ userId, companyId, role: role as never }, "Lead") as Prisma.LeadWhereInput;
  return prisma.lead.findFirst({ where: { AND: [{ id: leadId }, scope] }, select: { id: true } });
}

/** Get-or-create the scope for a lead the user can edit. */
async function ensureScope(leadId: string): Promise<
  { ok: true; scopeId: string; companyId: string } | { ok: false; error: string }
> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const lead = await leadAccessible(user.userId, user.companyId, user.role, leadId);
  if (!lead) return { ok: false, error: "Deal not found or access denied." };

  const existing = await prisma.scopeOfWork.findUnique({ where: { leadId }, select: { id: true } });
  if (existing) return { ok: true, scopeId: existing.id, companyId: user.companyId };

  const industry = await getActiveIndustry(user);
  const created = await prisma.scopeOfWork.create({
    data: { companyId: user.companyId, leadId, industry },
    select: { id: true },
  });
  return { ok: true, scopeId: created.id, companyId: user.companyId };
}

export async function ensureScopeAction(leadId: string): Promise<ScopeResult> {
  const res = await ensureScope(leadId);
  if (!res.ok) return res;
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true, scopeId: res.scopeId };
}

// ── Carrier scope PDF ───────────────────────────────────────────────────────

export async function uploadScopePdfAction(formData: FormData): Promise<Result> {
  const leadId = String(formData.get("leadId") ?? "");
  const ensured = await ensureScope(leadId);
  if (!ensured.ok) return ensured;

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return { ok: false, error: "No file provided." };
  if (file.size > MAX_PDF_BYTES) return { ok: false, error: "File too large (max 30MB)." };
  if (!PDF_ALLOWED.has(file.type)) return { ok: false, error: "Upload a PDF or image." };

  const buffer = Buffer.from(await file.arrayBuffer());
  const fid = nanoid();
  const key = `companies/${ensured.companyId}/scopes/${fid}-${safeName(file.name)}`;
  await putObject(key, buffer);

  const asset = await prisma.fileAsset.create({
    data: {
      companyId: ensured.companyId,
      kind: "document",
      name: file.name,
      storageKey: key,
      mimeType: file.type,
      size: buffer.length,
    },
    select: { id: true },
  });

  // Drop a previous PDF reference (best-effort cleanup of the old asset row).
  const prev = await prisma.scopeOfWork.findUnique({ where: { id: ensured.scopeId }, select: { pdfFileId: true } });
  await prisma.scopeOfWork.update({ where: { id: ensured.scopeId }, data: { pdfFileId: asset.id } });
  if (prev?.pdfFileId) {
    await prisma.fileAsset.deleteMany({ where: { id: prev.pdfFileId, companyId: ensured.companyId } });
  }

  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true };
}

export async function deleteScopePdfAction(leadId: string): Promise<Result> {
  const ensured = await ensureScope(leadId);
  if (!ensured.ok) return ensured;
  const scope = await prisma.scopeOfWork.findUnique({ where: { id: ensured.scopeId }, select: { pdfFileId: true } });
  await prisma.scopeOfWork.update({ where: { id: ensured.scopeId }, data: { pdfFileId: null } });
  if (scope?.pdfFileId) {
    await prisma.fileAsset.deleteMany({ where: { id: scope.pdfFileId, companyId: ensured.companyId } });
  }
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true };
}

// ── Line items ──────────────────────────────────────────────────────────────

export async function addScopeLineAction(input: {
  leadId: string;
  category?: string;
}): Promise<Result> {
  const ensured = await ensureScope(input.leadId);
  if (!ensured.ok) return ensured;
  const count = await prisma.scopeLine.count({ where: { scopeId: ensured.scopeId } });
  await prisma.scopeLine.create({
    data: {
      companyId: ensured.companyId,
      scopeId: ensured.scopeId,
      category: input.category?.trim() || "General",
      position: count,
    },
  });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

export async function updateScopeLineAction(input: {
  id: string;
  leadId: string;
  category?: string;
  description?: string;
  quantity?: number;
  unit?: string | null;
  insuranceUnitPriceCents?: number;
  supplementUnitPriceCents?: number;
  costUnitPriceCents?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const lead = await leadAccessible(user.userId, user.companyId, user.role, input.leadId);
  if (!lead) return { ok: false, error: "Access denied." };

  // Confirm the line belongs to this lead's scope (tenant-safe).
  const line = await prisma.scopeLine.findFirst({
    where: { id: input.id, companyId: user.companyId, scope: { leadId: input.leadId } },
    select: { id: true },
  });
  if (!line) return { ok: false, error: "Line not found." };

  const data: Prisma.ScopeLineUpdateInput = {};
  if (input.category !== undefined) data.category = input.category.trim() || "General";
  if (input.description !== undefined) data.description = input.description;
  if (input.quantity !== undefined) data.quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  if (input.unit !== undefined) data.unit = input.unit || null;
  if (input.insuranceUnitPriceCents !== undefined) {
    data.insuranceUnitPrice = Math.max(0, Math.round(input.insuranceUnitPriceCents));
  }
  // Supplement price is insurance-side (not a cost) — settable by any scope editor.
  if (input.supplementUnitPriceCents !== undefined) {
    data.supplementUnitPrice = Math.max(0, Math.round(input.supplementUnitPriceCents));
  }
  // Cost may only be set by management — silently ignore otherwise.
  if (input.costUnitPriceCents !== undefined && canSeeScopeCosts(user.role)) {
    data.costUnitPrice = Math.max(0, Math.round(input.costUnitPriceCents));
  }

  await prisma.scopeLine.update({ where: { id: input.id }, data });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

/** Set the public-adjuster fee % used in the supplement profit calc for a deal. */
export async function updateScopePaFeePctAction(input: {
  leadId: string;
  paFeePct: number;
}): Promise<Result> {
  const ensured = await ensureScope(input.leadId);
  if (!ensured.ok) return ensured;
  const pct = Number.isFinite(input.paFeePct) ? Math.min(100, Math.max(0, input.paFeePct)) : 0;
  await prisma.scopeOfWork.update({ where: { id: ensured.scopeId }, data: { paFeePct: pct } });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

export async function deleteScopeLineAction(input: { id: string; leadId: string }): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Scope")) return { ok: false, error: "Not allowed." };
  const line = await prisma.scopeLine.findFirst({
    where: { id: input.id, companyId: user.companyId, scope: { leadId: input.leadId } },
    select: { id: true },
  });
  if (!line) return { ok: false, error: "Line not found." };
  await prisma.scopeLine.delete({ where: { id: input.id } });
  revalidatePath(`/portal/leads/${input.leadId}`);
  return { ok: true };
}

// ── Bulk helpers ──────────────────────────────────────────────────────────

/** Copy the carrier scope's claim line items in as the insurance side. */
export async function importFromClaimAction(leadId: string): Promise<Result> {
  const ensured = await ensureScope(leadId);
  if (!ensured.ok) return ensured;

  const claim = await prisma.claim.findFirst({
    where: { leadId, companyId: ensured.companyId },
    select: { lineItems: { orderBy: { createdAt: "asc" } } },
  });
  const items = claim?.lineItems ?? [];
  if (items.length === 0) return { ok: false, error: "No claim line items to import." };

  let position = await prisma.scopeLine.count({ where: { scopeId: ensured.scopeId } });
  await prisma.scopeLine.createMany({
    data: items.map((li) => ({
      companyId: ensured.companyId,
      scopeId: ensured.scopeId,
      position: position++,
      category: li.code || "Insurance scope",
      description: li.description,
      quantity: li.quantity,
      unit: li.unit,
      insuranceUnitPrice: li.unitPrice,
      costUnitPrice: 0,
    })),
  });
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true };
}

/** Drop the company's scope template line items into this scope. */
export async function loadScopeTemplateAction(leadId: string): Promise<Result> {
  const ensured = await ensureScope(leadId);
  if (!ensured.ok) return ensured;

  const scope = await prisma.scopeOfWork.findUnique({
    where: { id: ensured.scopeId },
    select: { industry: true },
  });
  const items = await prisma.scopeTemplateItem.findMany({
    where: { companyId: ensured.companyId, industry: scope?.industry ?? "roofing" },
    orderBy: [{ position: "asc" }, { createdAt: "asc" }],
  });
  if (items.length === 0) return { ok: false, error: "No template items defined yet." };

  let position = await prisma.scopeLine.count({ where: { scopeId: ensured.scopeId } });
  await prisma.scopeLine.createMany({
    data: items.map((t) => ({
      companyId: ensured.companyId,
      scopeId: ensured.scopeId,
      position: position++,
      category: t.category,
      description: t.description,
      quantity: 0,
      unit: t.unit,
      insuranceUnitPrice: t.defaultInsuranceUnitPrice,
      costUnitPrice: t.defaultCostUnitPrice,
      supplementUnitPrice: t.defaultSupplementUnitPrice,
    })),
  });
  revalidatePath(`/portal/leads/${leadId}`);
  return { ok: true };
}

// ── Template management (Settings) ──────────────────────────────────────────

export async function addScopeTemplateItemAction(input: {
  category: string;
  description: string;
  unit?: string;
  defaultInsuranceUnitPriceCents?: number;
  defaultCostUnitPriceCents?: number;
  defaultSupplementUnitPriceCents?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };
  const industry = await getActiveIndustry(user);
  const count = await prisma.scopeTemplateItem.count({ where: { companyId: user.companyId, industry } });
  await prisma.scopeTemplateItem.create({
    data: {
      companyId: user.companyId,
      industry,
      position: count,
      category: input.category.trim() || "General",
      description: input.description.trim(),
      unit: input.unit?.trim() || null,
      defaultInsuranceUnitPrice: Math.max(0, Math.round(input.defaultInsuranceUnitPriceCents ?? 0)),
      defaultCostUnitPrice: Math.max(0, Math.round(input.defaultCostUnitPriceCents ?? 0)),
      defaultSupplementUnitPrice: Math.max(0, Math.round(input.defaultSupplementUnitPriceCents ?? 0)),
    },
  });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}

export async function updateScopeTemplateItemAction(input: {
  id: string;
  category?: string;
  description?: string;
  unit?: string | null;
  defaultInsuranceUnitPriceCents?: number;
  defaultCostUnitPriceCents?: number;
  defaultSupplementUnitPriceCents?: number;
}): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };
  const existing = await prisma.scopeTemplateItem.findFirst({
    where: { id: input.id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Item not found." };

  const data: Prisma.ScopeTemplateItemUpdateInput = {};
  if (input.category !== undefined) data.category = input.category.trim() || "General";
  if (input.description !== undefined) data.description = input.description.trim();
  if (input.unit !== undefined) data.unit = input.unit?.trim() || null;
  if (input.defaultInsuranceUnitPriceCents !== undefined)
    data.defaultInsuranceUnitPrice = Math.max(0, Math.round(input.defaultInsuranceUnitPriceCents));
  if (input.defaultCostUnitPriceCents !== undefined)
    data.defaultCostUnitPrice = Math.max(0, Math.round(input.defaultCostUnitPriceCents));
  if (input.defaultSupplementUnitPriceCents !== undefined)
    data.defaultSupplementUnitPrice = Math.max(0, Math.round(input.defaultSupplementUnitPriceCents));

  await prisma.scopeTemplateItem.update({ where: { id: input.id }, data });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}

export async function deleteScopeTemplateItemAction(id: string): Promise<Result> {
  const user = await requireUser();
  if (!can(user, "update", "Settings")) return { ok: false, error: "Not allowed." };
  const existing = await prisma.scopeTemplateItem.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true },
  });
  if (!existing) return { ok: false, error: "Item not found." };
  await prisma.scopeTemplateItem.delete({ where: { id } });
  revalidatePath("/portal/settings/scope-template");
  return { ok: true };
}
