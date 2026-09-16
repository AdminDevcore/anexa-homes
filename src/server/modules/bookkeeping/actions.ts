"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { nanoid } from "nanoid";
import { putObject } from "@/server/storage";
import { suggestForTransaction } from "./suggest";

function fail(error: string) {
  return { ok: false as const, error };
}
async function gate(action: "create" | "read" | "update" | "delete") {
  const user = await requireUser();
  if (!can(user, action, "Bookkeeping")) return { user: null, denied: fail("Not allowed.") };
  return { user, denied: null };
}

const txnSchema = z.object({
  date: z.string().min(1),
  description: z.string().min(1).max(200),
  direction: z.enum(["in", "out"]),
  amount: z.number().min(0), // dollars
  vendor: z.string().max(120).optional().or(z.literal("")),
  account: z.string().max(80).optional().or(z.literal("")),
  categoryId: z.string().optional().or(z.literal("")),
  projectId: z.string().optional().or(z.literal("")),
  invoiceId: z.string().optional().or(z.literal("")),
  notes: z.string().max(500).optional().or(z.literal("")),
});

export async function createTransactionAction(input: z.infer<typeof txnSchema>) {
  const { user, denied } = await gate("create");
  if (denied) return denied;
  const parsed = txnSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a date, description, and amount.");
  const d = parsed.data;
  const cents = Math.round(d.amount * 100) * (d.direction === "in" ? 1 : -1);
  const date = new Date(`${d.date}T12:00:00`);
  if (Number.isNaN(date.getTime())) return fail("Invalid date.");

  let categoryId = d.categoryId || null;
  let vendor = d.vendor || null;
  let autoSuggested = false;
  // If no category was chosen (e.g. a bank/QuickBooks import, or a quick entry),
  // auto-suggest the category + vendor and queue it for review/approval.
  if (!categoryId) {
    const [cats, vends] = await Promise.all([
      prisma.bookkeepingCategory.findMany({ where: { companyId: user!.companyId }, select: { id: true, name: true } }),
      prisma.bookkeepingVendor.findMany({ where: { companyId: user!.companyId }, select: { id: true, name: true } }),
    ]);
    const s = await suggestForTransaction(user!.companyId, d.description, d.account || null, cats, vends);
    categoryId = s.categoryId;
    if (!vendor) vendor = s.vendor;
    autoSuggested = !!(s.categoryId || s.vendor);
  }
  // A deliberate manual entry WITH a category is booked immediately; everything
  // else (imports, suggestions) waits in "To review" until approved.
  const approved = !!d.categoryId;

  await prisma.transaction.create({
    data: {
      companyId: user!.companyId,
      date,
      description: d.description,
      amountCents: cents,
      vendor,
      account: d.account || null,
      categoryId,
      projectId: d.projectId || null,
      invoiceId: d.invoiceId || null,
      status: categoryId ? "categorized" : "uncategorized",
      approved,
      autoSuggested,
      source: "manual",
      createdById: user!.userId,
    },
  });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Book a reviewed transaction (must be categorized first). */
export async function approveTransactionAction(id: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const txn = await prisma.transaction.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true, categoryId: true } });
  if (!txn) return fail("Transaction not found.");
  if (!txn.categoryId) return fail("Pick a category before approving.");
  await prisma.transaction.update({ where: { id }, data: { approved: true, autoSuggested: false, status: "categorized" } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Move a booked transaction back to the review queue. */
export async function unapproveTransactionAction(id: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const txn = await prisma.transaction.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true } });
  if (!txn) return fail("Transaction not found.");
  await prisma.transaction.update({ where: { id }, data: { approved: false } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Re-run auto-suggest on every un-approved transaction that still lacks a category. */
export async function autoSuggestUnreviewedAction() {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const [pending, cats, vends] = await Promise.all([
    prisma.transaction.findMany({ where: { companyId: user!.companyId, approved: false, categoryId: null }, select: { id: true, description: true, account: true, vendor: true } }),
    prisma.bookkeepingCategory.findMany({ where: { companyId: user!.companyId }, select: { id: true, name: true } }),
    prisma.bookkeepingVendor.findMany({ where: { companyId: user!.companyId }, select: { id: true, name: true } }),
  ]);
  let filled = 0;
  for (const t of pending) {
    const s = await suggestForTransaction(user!.companyId, t.description, t.account, cats, vends);
    if (s.categoryId || s.vendor) {
      await prisma.transaction.update({
        where: { id: t.id },
        data: { categoryId: s.categoryId ?? undefined, vendor: t.vendor ?? s.vendor ?? undefined, autoSuggested: true, status: s.categoryId ? "categorized" : "uncategorized" },
      });
      filled += 1;
    }
  }
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, filled };
}

const updateSchema = z.object({
  id: z.string().min(1),
  categoryId: z.string().optional().nullable(),
  projectId: z.string().optional().nullable(),
  vendor: z.string().max(120).optional().nullable(),
  account: z.string().max(80).optional().nullable(),
  notes: z.string().max(500).optional().nullable(),
});

/** Inline edits: categorize, tag to a deal/vendor, set account/notes. */
export async function updateTransactionAction(input: z.infer<typeof updateSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = updateSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid change.");
  const { id, categoryId, projectId, vendor, account, notes } = parsed.data;
  const txn = await prisma.transaction.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true } });
  if (!txn) return fail("Transaction not found.");
  await prisma.transaction.update({
    where: { id },
    data: {
      ...(categoryId !== undefined ? { categoryId: categoryId || null, status: categoryId ? "categorized" : "uncategorized" } : {}),
      ...(projectId !== undefined ? { projectId: projectId || null } : {}),
      ...(vendor !== undefined ? { vendor: vendor || null } : {}),
      ...(account !== undefined ? { account: account || null } : {}),
      ...(notes !== undefined ? { notes: notes || null } : {}),
    },
  });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

// QuickBooks-style vendor/contractor profile. Empty strings save as NULL.
const vendorFields = {
  name: z.string().min(1).max(120),
  companyName: z.string().max(160).optional().or(z.literal("")),
  contactName: z.string().max(120).optional().or(z.literal("")),
  email: z.string().max(160).optional().or(z.literal("")),
  phone: z.string().max(60).optional().or(z.literal("")),
  einTaxId: z.string().max(40).optional().or(z.literal("")),
  is1099: z.boolean().optional(),
  address: z.string().max(200).optional().or(z.literal("")),
  city: z.string().max(80).optional().or(z.literal("")),
  state: z.string().max(40).optional().or(z.literal("")),
  zip: z.string().max(20).optional().or(z.literal("")),
  accountNumber: z.string().max(80).optional().or(z.literal("")),
  notes: z.string().max(2000).optional().or(z.literal("")),
};
const vendorSchema = z.object(vendorFields);
const updateVendorSchema = z.object({ id: z.string().min(1), ...vendorFields });

function vendorData(d: z.infer<typeof vendorSchema>) {
  const s = (v?: string) => (v?.trim() ? v.trim() : null);
  return {
    name: d.name.trim(),
    companyName: s(d.companyName),
    contactName: s(d.contactName),
    email: s(d.email),
    phone: s(d.phone),
    einTaxId: s(d.einTaxId),
    is1099: d.is1099 ?? false,
    address: s(d.address),
    city: s(d.city),
    state: s(d.state),
    zip: s(d.zip),
    accountNumber: s(d.accountNumber),
    notes: s(d.notes),
  };
}

/** Add a vendor / contractor (full profile) to the managed list. */
export async function createVendorAction(input: z.infer<typeof vendorSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a vendor name.");
  await prisma.bookkeepingVendor.create({ data: { companyId: user!.companyId, ...vendorData(parsed.data) } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Update a vendor's full profile (and re-point transactions if the name changed). */
export async function updateVendorAction(input: z.infer<typeof updateVendorSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = updateVendorSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a vendor name.");
  const vendor = await prisma.bookkeepingVendor.findFirst({ where: { id: parsed.data.id, companyId: user!.companyId }, select: { id: true, name: true } });
  if (!vendor) return fail("Vendor not found.");
  const data = vendorData(parsed.data);
  const ops: Prisma.PrismaPromise<unknown>[] = [
    prisma.bookkeepingVendor.update({ where: { id: vendor.id }, data }),
  ];
  // Renaming re-points any transactions tagged with the old free-text name.
  if (data.name !== vendor.name) {
    ops.push(prisma.transaction.updateMany({ where: { companyId: user!.companyId, vendor: vendor.name }, data: { vendor: data.name } }));
  }
  await prisma.$transaction(ops);
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

export async function deleteVendorAction(id: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const vendor = await prisma.bookkeepingVendor.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true } });
  if (!vendor) return fail("Vendor not found.");
  // Transactions keep their free-text vendor name; we only drop the managed entry.
  await prisma.bookkeepingVendor.delete({ where: { id } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

export async function deleteTransactionAction(id: string) {
  const { user, denied } = await gate("delete");
  if (denied) return denied;
  const txn = await prisma.transaction.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true } });
  if (!txn) return fail("Transaction not found.");
  await prisma.transaction.delete({ where: { id } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

const catSchema = z.object({ name: z.string().min(1).max(80), type: z.enum(["income", "expense", "asset", "liability", "equity"]) });
export async function createCategoryAction(input: z.infer<typeof catSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = catSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a category name + type.");
  await prisma.bookkeepingCategory.create({ data: { companyId: user!.companyId, name: parsed.data.name, type: parsed.data.type } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

const updateCatSchema = catSchema.extend({ id: z.string().min(1) });
/** Rename / re-type a chart-of-accounts category. */
export async function updateCategoryAction(input: z.infer<typeof updateCatSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = updateCatSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a category name + type.");
  const cat = await prisma.bookkeepingCategory.findFirst({ where: { id: parsed.data.id, companyId: user!.companyId }, select: { id: true } });
  if (!cat) return fail("Category not found.");
  await prisma.bookkeepingCategory.update({ where: { id: cat.id }, data: { name: parsed.data.name, type: parsed.data.type } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

export async function deleteCategoryAction(id: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const cat = await prisma.bookkeepingCategory.findFirst({ where: { id, companyId: user!.companyId }, select: { id: true } });
  if (!cat) return fail("Category not found.");
  // Un-file any transactions on this category before removing it (FK is set null,
  // but we also flip their status back to uncategorized).
  await prisma.$transaction([
    prisma.transaction.updateMany({ where: { companyId: user!.companyId, categoryId: id }, data: { categoryId: null, status: "uncategorized" } }),
    prisma.bookkeepingCategory.delete({ where: { id } }),
  ]);
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

// The "Connect bank / QuickBooks" action is GONE, along with the dialog that
// called it and the two CompanySettings columns it wrote.
//
// It was a picker between "quickbooks", "plaid" and "manual" plus a key field,
// and nothing in the codebase ever read either value to do anything: no sync
// ran, no request was signed, no transaction was ever fetched. What it did do
// was tell an owner "Connected · plaid" on the bookkeeping page, which is worse
// than an empty screen — it is a screen that says the books are being fed when
// they are not.
//
// Real bank feeds arrive in Phase 2 behind `src/server/modules/bank-feeds/`,
// with the access token encrypted under a versioned key and a BankConnection
// row whose status reflects an actual connection.

// ---- Transaction attachments (receipts / invoices) -------------------------

const MAX_ATTACH_BYTES = 30 * 1024 * 1024;
const ATTACH_ALLOWED = new Set([
  "application/pdf", "image/jpeg", "image/png", "image/webp", "image/gif", "image/heic",
  "application/msword", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.ms-excel", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", "text/csv",
]);
function safeName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "receipt";
}

/** Attach a receipt / invoice file to a transaction. */
export async function uploadTransactionAttachmentAction(formData: FormData) {
  const { user, denied } = await gate("update");
  if (denied) return denied;

  const transactionId = String(formData.get("transactionId") ?? "");
  const txn = await prisma.transaction.findFirst({ where: { id: transactionId, companyId: user!.companyId }, select: { id: true } });
  if (!txn) return fail("Transaction not found.");

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) return fail("No file provided.");
  if (file.size > MAX_ATTACH_BYTES) return fail("File too large (max 30MB).");
  if (!ATTACH_ALLOWED.has(file.type)) return fail("Unsupported file type.");

  const buffer = Buffer.from(await file.arrayBuffer());
  const fid = nanoid();
  const key = `companies/${user!.companyId}/transactions/${fid}-${safeName(file.name)}`;
  await putObject(key, buffer);

  await prisma.fileAsset.create({
    data: {
      companyId: user!.companyId,
      kind: file.type.startsWith("image/") ? "photo" : "document",
      name: file.name,
      storageKey: key,
      mimeType: file.type,
      size: buffer.length,
      // One company, one general ledger — a receipt belongs to the books, not to
      // a workspace, and accounting reconciles both departments from one screen.
      scope: "company",
      transactionId,
      uploadedById: user!.userId,
    },
  });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

/** Remove an attachment from a transaction. */
export async function deleteTransactionAttachmentAction(fileId: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const file = await prisma.fileAsset.findFirst({
    where: { id: fileId, companyId: user!.companyId, transactionId: { not: null } },
    select: { id: true },
  });
  if (!file) return fail("Attachment not found.");
  await prisma.fileAsset.delete({ where: { id: fileId } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

// ── Bank reconciliation ─────────────────────────────────────────────────────

const finishReconcileSchema = z.object({
  account: z.string().min(1).max(80),
  statementDate: z.string().min(1),
  endingBalanceCents: z.number().int(),
  transactionIds: z.array(z.string().min(1)).min(1).max(2000),
});

/**
 * Finish a reconciliation: mark the selected (cleared) transactions reconciled
 * and record the statement. Validates the cleared balance equals the statement
 * ending balance so the books can't be reconciled out of balance.
 */
export async function finishReconciliationAction(input: z.infer<typeof finishReconcileSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = finishReconcileSchema.safeParse(input);
  if (!parsed.success) return fail("Check the reconciliation and try again.");
  const { account, statementDate, endingBalanceCents, transactionIds } = parsed.data;
  const stmtDate = new Date(`${statementDate}T12:00:00`);
  if (Number.isNaN(stmtDate.getTime())) return fail("Enter a valid statement date.");

  // The cleared transactions, scoped to this company + account, not already reconciled.
  const cleared = await prisma.transaction.findMany({
    where: { id: { in: transactionIds }, companyId: user.companyId, account, status: { not: "reconciled" } },
    select: { id: true, amountCents: true },
  });
  if (cleared.length === 0) return fail("Select at least one transaction to clear.");

  // Beginning balance = everything already reconciled on this account (authoritative).
  const prior = await prisma.transaction.aggregate({
    where: { companyId: user.companyId, account, status: "reconciled" },
    _sum: { amountCents: true },
  });
  const beginning = prior._sum.amountCents ?? 0;
  const clearedSum = cleared.reduce((s, t) => s + t.amountCents, 0);
  if (beginning + clearedSum !== endingBalanceCents) {
    return fail("Out of balance — cleared total doesn't match the statement ending balance.");
  }

  const recon = await prisma.reconciliation.create({
    data: {
      companyId: user.companyId,
      account,
      statementDate: stmtDate,
      endingBalanceCents,
      beginningBalanceCents: beginning,
      clearedCount: cleared.length,
      createdById: user.userId,
    },
    select: { id: true },
  });
  await prisma.transaction.updateMany({
    where: { id: { in: cleared.map((t) => t.id) }, companyId: user.companyId },
    data: { status: "reconciled", reconciledAt: new Date(), reconciliationId: recon.id },
  });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const, id: recon.id };
}

/** Undo a reconciliation: release its transactions back to "categorized" and delete it. */
export async function undoReconciliationAction(id: string) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const recon = await prisma.reconciliation.findFirst({ where: { id, companyId: user.companyId }, select: { id: true } });
  if (!recon) return fail("Reconciliation not found.");
  await prisma.transaction.updateMany({
    where: { reconciliationId: recon.id, companyId: user.companyId },
    data: { status: "categorized", reconciledAt: null, reconciliationId: null },
  });
  await prisma.reconciliation.delete({ where: { id: recon.id } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}
