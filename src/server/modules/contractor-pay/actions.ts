"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { prisma } from "@/server/db/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { CONTRACTOR_INVOICE_CATEGORY } from "@/lib/contractor-invoice";

function fail(error: string) {
  return { ok: false as const, error };
}
function ok<T extends object = object>(data?: T) {
  return { ok: true as const, ...(data ?? {}) };
}

/**
 * Every action here is gated on `ContractorInvoice`, never on `Commission`.
 *
 * They look like the commission actions and they feed the same payroll run, but
 * the permission is the whole point of the feature: what a subcontractor charges
 * is a cost of goods, and the rep whose commission it eats into holds
 * `Commission:update`. See src/lib/contractor-invoice.ts.
 */

const PATHS = ["/portal/contractor-pay", "/portal/payroll"];
const refresh = () => PATHS.forEach((p) => revalidatePath(p));

/**
 * Turn submitted invoices into pay lines — one per invoice, never a second.
 *
 * "Generate" here is the same gesture as on the Commissions tab and it is the
 * only thing about them that is the same. A commission is COMPUTED: a rule and
 * a pool produce a number, and re-generating refreshes it. This cannot be
 * computed at all. Nothing in the product reads a PDF, so the amount lands at
 * zero and stays there until a human opens the invoice and types what it says —
 * which is also why approving a zero is refused rather than quietly banked.
 *
 * Idempotent through `invoiceId`'s unique index: press it twice and the second
 * press creates nothing. An invoice whose uploader's account has since been
 * deleted is skipped and reported, because a payable needs somebody to pay.
 */
export async function generateContractorPayAction() {
  const user = await requireUser();
  if (!can(user, "update", "ContractorInvoice")) return fail("Not allowed.");

  const invoices = await prisma.fileAsset.findMany({
    where: {
      companyId: user.companyId,
      category: CONTRACTOR_INVOICE_CATEGORY,
      contractorPay: { is: null },
    },
    select: {
      id: true,
      name: true,
      uploadedById: true,
      projectId: true,
      lead: { select: { project: { select: { id: true } } } },
    },
  });

  let created = 0;
  let orphaned = 0;
  for (const inv of invoices) {
    if (!inv.uploadedById) {
      orphaned += 1;
      continue;
    }
    // The invoice may carry the job directly (submitted from the job page) or
    // only the deal (dropped in the folder). Either way the pay line wants the
    // job, because that is what the ledger tags an expense to.
    const projectId = inv.projectId ?? inv.lead?.project?.id ?? null;
    await prisma.contractorPay.create({
      data: {
        companyId: user.companyId,
        invoiceId: inv.id,
        projectId,
        userId: inv.uploadedById,
        amount: 0,
        label: inv.name,
      },
    });
    created += 1;
  }

  refresh();

  // "0 generated" on its own reads as a broken button, so say which nothing
  // this is: nothing new, or nothing payable.
  const message =
    created > 0
      ? orphaned > 0
        ? `${orphaned} invoice(s) skipped — the account that submitted them no longer exists.`
        : undefined
      : orphaned > 0
        ? `Nothing to generate. ${orphaned} invoice(s) were submitted by accounts that no longer exist, so there is nobody to pay.`
        : "Nothing new — every submitted invoice already has a pay line.";

  return { ok: true as const, created, message };
}

const amountSchema = z.object({
  id: z.string().min(1),
  // Cents. Capped at $1,000,000 to catch a dollars-vs-cents slip before it
  // reaches a payroll run rather than after.
  amount: z.number().int().min(0).max(100_000_000),
});

/**
 * Type what the invoice says — or correct it afterwards.
 *
 * Editable while the line is `pending` or `approved`, and refused once it is in
 * a payroll run. That boundary is where the number stops being an opinion and
 * starts being a batched payable: changing it after the run exists would leave
 * the run's total disagreeing with its own line, and the run is what somebody
 * pays from.
 */
export async function setContractorPayAmountAction(input: z.infer<typeof amountSchema>) {
  const user = await requireUser();
  if (!can(user, "update", "ContractorInvoice")) return fail("Not allowed.");
  const parsed = amountSchema.safeParse(input);
  if (!parsed.success) return fail("Enter an amount between $0 and $1,000,000.");

  const row = await prisma.contractorPay.findFirst({
    where: { id: parsed.data.id, companyId: user.companyId },
    select: { id: true, status: true, _count: { select: { payrollItems: true } } },
  });
  if (!row) return fail("Pay line not found.");
  if (row.status === "paid") return fail("This invoice has already been paid.");
  if (row._count.payrollItems > 0) {
    return fail("This line is already in a payroll run. Delete the run to change the amount.");
  }

  await prisma.contractorPay.update({
    where: { id: parsed.data.id },
    data: { amount: parsed.data.amount },
  });
  refresh();
  return ok();
}

export async function approveContractorPayAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "ContractorInvoice")) return fail("Not allowed.");
  const row = await prisma.contractorPay.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, amount: true, status: true },
  });
  if (!row) return fail("Pay line not found.");
  // A zero is not an approval, it is an invoice nobody has read yet. Payroll
  // batches whatever is approved, so a zero waved through here becomes a $0
  // line on a pay stub and a contractor who was told he was paid.
  if (row.amount <= 0) return fail("Enter the invoice amount before approving.");

  await prisma.contractorPay.update({
    where: { id },
    data: { status: "approved", approvedAt: new Date() },
  });
  refresh();
  return ok();
}

/** Approve every pending line that has an amount on it. */
export async function approveAllPendingContractorPayAction() {
  const user = await requireUser();
  if (!can(user, "approve", "ContractorInvoice")) return fail("Not allowed.");
  const res = await prisma.contractorPay.updateMany({
    where: { companyId: user.companyId, status: "pending", amount: { gt: 0 } },
    data: { status: "approved", approvedAt: new Date() },
  });
  const unpriced = await prisma.contractorPay.count({
    where: { companyId: user.companyId, status: "pending", amount: 0 },
  });
  refresh();
  return {
    ok: true as const,
    count: res.count,
    // Named rather than silently left behind: "Approve all" that quietly skips
    // half the list is how an invoice sits unpaid for a month.
    message:
      unpriced > 0
        ? `${res.count} approved. ${unpriced} still need an amount typed in.`
        : undefined,
  };
}

/** Send an approved line back for correction. */
export async function unapproveContractorPayAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "ContractorInvoice")) return fail("Not allowed.");
  const row = await prisma.contractorPay.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, status: true, _count: { select: { payrollItems: true } } },
  });
  if (!row) return fail("Pay line not found.");
  if (row.status === "paid") return fail("This invoice has already been paid.");
  if (row._count.payrollItems > 0) {
    return fail("This line is already in a payroll run. Delete the run first.");
  }
  await prisma.contractorPay.update({ where: { id }, data: { status: "pending", approvedAt: null } });
  refresh();
  return ok();
}

/**
 * Void a line — we are not paying this invoice.
 *
 * The invoice itself survives. Voiding says "we owe nothing for this", not
 * "this was never submitted", and destroying the contractor's evidence that he
 * billed is a separate act with a separate permission (delete, super_admin
 * only). See the delete guard in modules/files/actions.ts.
 */
export async function voidContractorPayAction(id: string) {
  const user = await requireUser();
  if (!can(user, "approve", "ContractorInvoice")) return fail("Not allowed.");
  const row = await prisma.contractorPay.findFirst({
    where: { id, companyId: user.companyId },
    select: { id: true, status: true, _count: { select: { payrollItems: true } } },
  });
  if (!row) return fail("Pay line not found.");
  if (row.status === "paid") return fail("This invoice has already been paid.");
  if (row._count.payrollItems > 0) {
    return fail("This line is already in a payroll run. Delete the run first.");
  }
  await prisma.contractorPay.update({ where: { id }, data: { status: "void" } });
  refresh();
  return ok();
}
