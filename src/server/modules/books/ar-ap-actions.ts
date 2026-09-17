"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Vertical } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import type { PostingActor } from "./posting";
import { createInvoice, postInvoiceAccrual, receiveInvoicePayment, voidInvoice } from "./invoices";
import { createBill, postBillAccrual, payBill, voidBill } from "./bills";
import { syncExpectedFundings, recogniseFunding } from "./funding";

/**
 * THE A/R, A/P AND LENDER-FUNDING ACTION SURFACE.
 *
 * Phase 4 built invoices, bills and lender funding as modules and never gave
 * them a door. Fifteen functions existed that no screen could call, which means
 * the feature was finished in the sense that the tests passed and unfinished in
 * every sense that matters to the person trying to raise an invoice.
 *
 * A separate file from `actions.ts` rather than 350 more lines in it, following
 * the same split payroll already uses (`actions.ts` + `ledger-actions.ts`).
 *
 * The rules are the same as next door, and worth restating because each export
 * here is a PUBLIC RPC endpoint rather than a function only its own page may
 * call:
 *
 * - `gate()` is the only way in, and it re-establishes the caller rather than
 *   trusting the page that linked here.
 * - No export takes a `companyId`. It comes from the session every time, which
 *   is what `server-action-boundary.test.ts` enforces repo-wide.
 * - Dollars are converted to integer cents once, at this edge. Nothing below
 *   this file has to wonder which unit it is holding.
 * - Voids go through the modules' reversing-entry paths. Nothing here deletes.
 *
 * The reads (`arAging`, `apAging`, `openFundings`) are deliberately absent:
 * a server component calls those directly, so exposing them as actions would
 * add a public endpoint for no caller.
 */

function fail(error: string) {
  return { ok: false as const, error };
}

async function gate(action: "create" | "read" | "update" | "delete") {
  const user = await requireUser();
  if (!can(user, action, "Bookkeeping")) {
    return { user: null, actor: null, denied: fail("Not allowed.") };
  }
  const actor: PostingActor = { kind: "user", userId: user.userId, role: user.role };
  return { user, actor, denied: null };
}

const toCents = (dollars: number | undefined): number => Math.round((dollars ?? 0) * 100);

/**
 * Midday, deliberately. A date the user typed is a calendar day, not an
 * instant; parsing it at midnight puts it on the previous day for anyone behind
 * UTC, which would file an invoice in the wrong period at a month boundary.
 */
function calendarDay(value: string): Date {
  return new Date(`${value}T12:00:00`);
}

function revalidateBooks() {
  revalidatePath("/portal/books");
  revalidatePath("/portal/books/receivables");
  revalidatePath("/portal/books/payables");
}

// ── Receivables ─────────────────────────────────────────────────────────────

const invoiceSchema = z.object({
  projectId: z.string().min(1),
  invoiceNumber: z.string().min(1).max(60),
  amount: z.number().positive(),
  issuedAt: z.string().min(1),
  dueAt: z.string().nullish(),
  revenueAccountId: z.string().nullish(),
  revenueSystemKey: z.string().nullish(),
  notes: z.string().max(300).nullish(),
  status: z.enum(["draft", "sent"]).optional(),
});

/**
 * Raise an invoice against a job, and post it to A/R unless it is a draft.
 *
 * The revenue account is left unset by default on purpose: the module derives
 * it from the JOB's department, so the figure lands in Roofing or Solar revenue
 * according to the work, not according to which workspace the person raising it
 * happens to be looking at.
 */
export async function createInvoiceAction(input: z.infer<typeof invoiceSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = invoiceSchema.safeParse(input);
  if (!parsed.success) return fail("Give the invoice a job, a number, an amount and an issue date.");
  const d = parsed.data;

  const issuedAt = calendarDay(d.issuedAt);
  if (Number.isNaN(issuedAt.getTime())) return fail("Enter a valid issue date.");

  let dueAt: Date | null = null;
  if (d.dueAt) {
    dueAt = calendarDay(d.dueAt);
    if (Number.isNaN(dueAt.getTime())) return fail("Enter a valid due date.");
  }

  const res = await createInvoice({
    companyId: user!.companyId,
    projectId: d.projectId,
    invoiceNumber: d.invoiceNumber,
    amountCents: toCents(d.amount),
    issuedAt,
    dueAt,
    revenueAccountId: d.revenueAccountId ?? null,
    revenueSystemKey: d.revenueSystemKey ?? null,
    notes: d.notes ?? null,
    status: d.status,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, invoiceId: res.invoiceId, entryId: res.entryId };
}

const invoiceAccrualSchema = z.object({
  invoiceId: z.string().min(1),
  revenueAccountId: z.string().nullish(),
  revenueSystemKey: z.string().nullish(),
});

/** Post a draft invoice to the ledger, or re-post one whose first attempt failed. */
export async function postInvoiceAccrualAction(input: z.infer<typeof invoiceAccrualSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = invoiceAccrualSchema.safeParse(input);
  if (!parsed.success) return fail("Pick an invoice to post.");

  const res = await postInvoiceAccrual({
    companyId: user!.companyId,
    invoiceId: parsed.data.invoiceId,
    revenueAccountId: parsed.data.revenueAccountId ?? null,
    revenueSystemKey: parsed.data.revenueSystemKey ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, entryId: res.entryId };
}

const receiptSchema = z.object({
  invoiceId: z.string().min(1),
  bankLedgerAccountId: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().max(300).nullish(),
});

/** The customer paid: clear A/R into the bank. */
export async function receiveInvoicePaymentAction(input: z.infer<typeof receiptSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = receiptSchema.safeParse(input);
  if (!parsed.success) return fail("Pick an invoice, an account and a date.");
  const d = parsed.data;

  const date = calendarDay(d.date);
  if (Number.isNaN(date.getTime())) return fail("Enter a valid date.");

  const res = await receiveInvoicePayment({
    companyId: user!.companyId,
    invoiceId: d.invoiceId,
    bankLedgerAccountId: d.bankLedgerAccountId,
    date,
    memo: d.memo ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, entryId: res.entryId };
}

const voidInvoiceSchema = z.object({
  invoiceId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

/** Void by reversal, with a reason. Never a delete. */
export async function voidInvoiceAction(input: z.infer<typeof voidInvoiceSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = voidInvoiceSchema.safeParse(input);
  if (!parsed.success) return fail("Say why this invoice is being voided.");

  const res = await voidInvoice({
    companyId: user!.companyId,
    invoiceId: parsed.data.invoiceId,
    reason: parsed.data.reason,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, reversalId: res.reversalId };
}

// ── Payables ────────────────────────────────────────────────────────────────

const billSchema = z.object({
  vendorId: z.string().min(1),
  billNumber: z.string().min(1).max(60),
  amount: z.number().positive(),
  billedAt: z.string().min(1),
  dueAt: z.string().nullish(),
  expenseAccountId: z.string().nullish(),
  expenseSystemKey: z.string().nullish(),
  projectId: z.string().nullish(),
  vertical: z.enum(["roofing", "solar", "others"]).nullish(),
  memo: z.string().max(300).nullish(),
  status: z.enum(["draft", "open"]).optional(),
});

/**
 * Enter a vendor bill, and accrue it unless it is a draft.
 *
 * Either an expense account or a system key is required — the module refuses a
 * bill with neither rather than guessing an account, because a cost filed to the
 * wrong line is harder to find later than a bill that would not save.
 */
export async function createBillAction(input: z.infer<typeof billSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = billSchema.safeParse(input);
  if (!parsed.success) return fail("Give the bill a vendor, a number, an amount and a date.");
  const d = parsed.data;

  const billedAt = calendarDay(d.billedAt);
  if (Number.isNaN(billedAt.getTime())) return fail("Enter a valid bill date.");

  let dueAt: Date | null = null;
  if (d.dueAt) {
    dueAt = calendarDay(d.dueAt);
    if (Number.isNaN(dueAt.getTime())) return fail("Enter a valid due date.");
  }

  const res = await createBill({
    companyId: user!.companyId,
    vendorId: d.vendorId,
    billNumber: d.billNumber,
    amountCents: toCents(d.amount),
    billedAt,
    dueAt,
    expenseAccountId: d.expenseAccountId ?? null,
    expenseSystemKey: d.expenseSystemKey ?? null,
    projectId: d.projectId ?? null,
    vertical: (d.vertical ?? null) as Vertical | null,
    memo: d.memo ?? null,
    status: d.status,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, billId: res.billId, entryId: res.entryId };
}

const billAccrualSchema = z.object({ billId: z.string().min(1) });

/** Accrue a draft bill, or re-accrue one whose first attempt failed. */
export async function postBillAccrualAction(input: z.infer<typeof billAccrualSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = billAccrualSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a bill to accrue.");

  const res = await postBillAccrual({
    companyId: user!.companyId,
    billId: parsed.data.billId,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, entryId: res.entryId };
}

const payBillSchema = z.object({
  billId: z.string().min(1),
  bankLedgerAccountId: z.string().min(1),
  date: z.string().min(1),
  memo: z.string().max(300).nullish(),
});

/**
 * Settle a bill straight from a bank account.
 *
 * This is the manual path — someone wrote a cheque, or paid the card. It is NOT
 * the ACH path: that goes through `payments/actions.ts`, which carries the
 * maker-checker split, the second factor and the payee cooling-off period. This
 * one records a payment that already happened outside the system; that one makes
 * one happen.
 */
export async function payBillAction(input: z.infer<typeof payBillSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = payBillSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a bill, an account and a date.");
  const d = parsed.data;

  const date = calendarDay(d.date);
  if (Number.isNaN(date.getTime())) return fail("Enter a valid date.");

  const res = await payBill({
    companyId: user!.companyId,
    billId: d.billId,
    bankLedgerAccountId: d.bankLedgerAccountId,
    date,
    memo: d.memo ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, entryId: res.entryId };
}

const voidBillSchema = z.object({
  billId: z.string().min(1),
  reason: z.string().min(1).max(300),
});

/** Void by reversal, with a reason. Never a delete. */
export async function voidBillAction(input: z.infer<typeof voidBillSchema>) {
  const { user, actor, denied } = await gate("update");
  if (denied) return denied;
  const parsed = voidBillSchema.safeParse(input);
  if (!parsed.success) return fail("Say why this bill is being voided.");

  const res = await voidBill({
    companyId: user!.companyId,
    billId: parsed.data.billId,
    reason: parsed.data.reason,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, reversalId: res.reversalId };
}

// ── Lender funding ──────────────────────────────────────────────────────────

const syncFundingSchema = z.object({ leadId: z.string().min(1) });

/**
 * Work out what the lender owes on a deal and write the expected milestones.
 *
 * Idempotent by milestone, so pressing it again after the financing changes
 * updates the expectation rather than duplicating it.
 */
export async function syncExpectedFundingsAction(input: z.infer<typeof syncFundingSchema>) {
  const { user, denied } = await gate("create");
  if (denied) return denied;
  const parsed = syncFundingSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a deal.");

  const res = await syncExpectedFundings({
    companyId: user!.companyId,
    leadId: parsed.data.leadId,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, written: res.written, skipped: res.skipped };
}

const recogniseFundingSchema = z.object({
  fundingId: z.string().min(1),
  bankLedgerAccountId: z.string().min(1),
  received: z.number().positive(),
  date: z.string().min(1),
  memo: z.string().max(300).nullish(),
});

/**
 * Recognise a lender deposit against an expected milestone.
 *
 * The amount is what ACTUALLY arrived, not what was expected — the module books
 * the difference as a variance rather than silently accepting a short payment as
 * payment in full.
 */
export async function recogniseFundingAction(input: z.infer<typeof recogniseFundingSchema>) {
  const { user, actor, denied } = await gate("create");
  if (denied) return denied;
  const parsed = recogniseFundingSchema.safeParse(input);
  if (!parsed.success) return fail("Pick a milestone, an account, an amount and a date.");
  const d = parsed.data;

  const date = calendarDay(d.date);
  if (Number.isNaN(date.getTime())) return fail("Enter a valid date.");

  const res = await recogniseFunding({
    companyId: user!.companyId,
    fundingId: d.fundingId,
    bankLedgerAccountId: d.bankLedgerAccountId,
    receivedCents: toCents(d.received),
    date,
    memo: d.memo ?? null,
    actor: actor!,
  });
  if (!res.ok) return res;
  revalidateBooks();
  return { ok: true as const, entryId: res.entryId };
}
