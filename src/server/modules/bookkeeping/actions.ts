"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
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

const vendorSchema = z.object({ name: z.string().min(1).max(120) });
/** Add a vendor / contractor to the managed list. */
export async function createVendorAction(input: z.infer<typeof vendorSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = vendorSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a vendor name.");
  await prisma.bookkeepingVendor.create({ data: { companyId: user!.companyId, name: parsed.data.name.trim() } });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}

const renameVendorSchema = z.object({ id: z.string().min(1), name: z.string().min(1).max(120) });
/** Rename a vendor (and re-point any transactions tagged with the old name). */
export async function renameVendorAction(input: z.infer<typeof renameVendorSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = renameVendorSchema.safeParse(input);
  if (!parsed.success) return fail("Enter a vendor name.");
  const vendor = await prisma.bookkeepingVendor.findFirst({ where: { id: parsed.data.id, companyId: user!.companyId }, select: { id: true, name: true } });
  if (!vendor) return fail("Vendor not found.");
  const name = parsed.data.name.trim();
  await prisma.$transaction([
    prisma.bookkeepingVendor.update({ where: { id: vendor.id }, data: { name } }),
    prisma.transaction.updateMany({ where: { companyId: user!.companyId, vendor: vendor.name }, data: { vendor: name } }),
  ]);
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

const connSchema = z.object({ provider: z.enum(["quickbooks", "plaid", "manual"]), apiKey: z.string().max(400).optional().or(z.literal("")) });
/** Save the bank/QuickBooks connection key. Live sync is handled by the connector. */
export async function setBookkeepingConnectionAction(input: z.infer<typeof connSchema>) {
  const { user, denied } = await gate("update");
  if (denied) return denied;
  const parsed = connSchema.safeParse(input);
  if (!parsed.success) return fail("Invalid connection.");
  await prisma.companySettings.update({
    where: { companyId: user!.companyId },
    data: { bookkeepingProvider: parsed.data.provider, bookkeepingApiKey: parsed.data.apiKey || null },
  });
  revalidatePath("/portal/bookkeeping");
  return { ok: true as const };
}
