import type { BillStatus, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import {
  postJournalEntry,
  voidJournalEntry,
  type JournalLineInput,
  type PostingActor,
} from "./posting";
import { bucketFor, daysOverdue, emptyBucketTotals, type AgingBucket } from "./aging";

/**
 * VENDOR BILLS — what we owe, from the day the vendor billed us.
 *
 * ── TWO EVENTS, NOT ONE ─────────────────────────────────────────────────────
 * A bill entered in March and paid in May is an EXPENSE in March and a movement
 * of CASH in May. That is the whole reason accrual accounting exists, and it is
 * the same shape payroll already uses here (accrue on approval, settle on
 * payment). Booking a bill only when it is paid would mean a company that owes
 * $40,000 to its subcontractors shows no liability at all — a balance sheet
 * that cannot say what is owed is not a balance sheet.
 *
 *   entered    expense (tagged to the job)   →  Accounts Payable
 *   paid       Accounts Payable              →  the bank account
 *
 * ── THE SOURCE KEYS ─────────────────────────────────────────────────────────
 * `bill:<id>` for the accrual and `bill:<id>:payment` for the settlement,
 * exactly as the schema comment on `Bill` states. They become the entry's
 * (sourceType, sourceId), which is uniquely constrained, so a retry after a
 * half-finished write cannot book either event twice.
 *
 * ── DRAFTS DO NOT POST ──────────────────────────────────────────────────────
 * A draft is something somebody is still typing. It has no journal entry, so it
 * is not in the books and not in A/P — which is right, because an amount nobody
 * has confirmed is not yet a debt.
 */

const accrualSourceId = (billId: string) => `bill:${billId}`;
const paymentSourceId = (billId: string) => `bill:${billId}:payment`;

export type BillResult =
  | { ok: true; billId: string; entryId: string | null }
  | { ok: false; error: string };

export type CreateBillInput = {
  companyId: string;
  vendorId: string;
  billNumber: string;
  amountCents: number;
  billedAt: Date;
  dueAt?: Date | null;
  /** Where the cost lands. A system key is resolved by the posting service. */
  expenseAccountId?: string | null;
  expenseSystemKey?: string | null;
  projectId?: string | null;
  vertical?: Vertical | null;
  memo?: string | null;
  /** A draft is recorded but not posted. */
  status?: Extract<BillStatus, "draft" | "open">;
  actor: PostingActor;
};

/**
 * Enter a bill, and accrue it unless it is a draft.
 *
 * The Bill row and its journal entry are written in that order rather than in
 * one transaction, deliberately: `postJournalEntry` is the only door to the
 * ledger and runs its own transaction with its own period-lock and reference
 * checks. A bill whose posting fails is left with `journalEntryId` null and
 * returns the error, which is visible and re-postable — as against wrapping the
 * door in a second transaction, which would put two competing transaction
 * scopes around the same rows.
 */
export async function createBill(input: CreateBillInput): Promise<BillResult> {
  const status = input.status ?? "open";

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "A bill must be a positive whole number of cents." };
  }
  if (!input.expenseAccountId && !input.expenseSystemKey) {
    return { ok: false, error: "Choose the expense account this bill lands in." };
  }
  if (!input.billNumber.trim()) {
    return { ok: false, error: "Give the bill a number — the vendor's, if it has one." };
  }

  const vendor = await prisma.bookkeepingVendor.findFirst({
    where: { id: input.vendorId, companyId: input.companyId },
    select: { id: true, name: true },
  });
  if (!vendor) return { ok: false, error: "That vendor is not on this company." };

  // Checked here for a readable error. The unique index is what actually
  // guarantees it — two requests can pass this check at the same moment.
  const clash = await prisma.bill.findFirst({
    where: { companyId: input.companyId, billNumber: input.billNumber.trim() },
    select: { id: true },
  });
  if (clash) return { ok: false, error: `Bill ${input.billNumber} already exists.` };

  // TAGGED FROM THE JOB, EXPLICITLY. Bill is classified TAGGED with `projectId`
  // provenance, but the vertical extension returns early for unscoped callers —
  // which is the books' normal state — so the row would otherwise be written
  // with no department, and a bill-level breakout would show nothing.
  const projectId = input.projectId ?? null;
  let vertical = input.vertical ?? null;
  if (!vertical && projectId) {
    const project = await runUnscoped("books: a bill's department is its job's", () =>
      prisma.project.findFirst({
        where: { id: projectId, companyId: input.companyId },
        select: { vertical: true },
      })
    );
    vertical = project?.vertical ?? null;
  }

  const bill = await prisma.bill.create({
    data: {
      companyId: input.companyId,
      vendorId: vendor.id,
      billNumber: input.billNumber.trim(),
      status,
      amountCents: input.amountCents,
      billedAt: input.billedAt,
      dueAt: input.dueAt ?? null,
      projectId,
      expenseAccountId: input.expenseAccountId ?? null,
      vertical,
      memo: input.memo ?? null,
      createdById: input.actor.kind === "user" ? input.actor.userId : null,
    },
    select: { id: true },
  });

  if (status === "draft") return { ok: true, billId: bill.id, entryId: null };

  const posted = await postBillAccrual({
    companyId: input.companyId,
    billId: bill.id,
    actor: input.actor,
  });
  if (!posted.ok) return { ok: false, error: posted.error };

  return { ok: true, billId: bill.id, entryId: posted.entryId };
}

/**
 * Accrue a bill: the expense against Accounts Payable.
 *
 * Separate from `createBill` so a draft can be posted later without re-entering
 * it, and so a failed posting can be retried against the row that already
 * exists.
 */
export async function postBillAccrual(args: {
  companyId: string;
  billId: string;
  actor: PostingActor;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const bill = await prisma.bill.findFirst({
    where: { id: args.billId, companyId: args.companyId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      billedAt: true,
      billNumber: true,
      projectId: true,
      vertical: true,
      expenseAccountId: true,
      journalEntryId: true,
      memo: true,
      vendorId: true,
      vendor: { select: { name: true } },
    },
  });
  if (!bill) return { ok: false, error: "That bill is not on this company." };
  if (bill.journalEntryId) return { ok: false, error: "This bill is already in the books." };
  if (bill.status === "void") return { ok: false, error: "This bill has been voided." };
  if (!bill.expenseAccountId) {
    return { ok: false, error: "This bill has no expense account." };
  }

  const lines: JournalLineInput[] = [
    {
      accountId: bill.expenseAccountId,
      debitCents: bill.amountCents,
      projectId: bill.projectId,
      vendorId: bill.vendorId,
      vertical: bill.vertical,
    },
    {
      systemKey: "accounts_payable",
      creditCents: bill.amountCents,
      projectId: bill.projectId,
      vendorId: bill.vendorId,
      vertical: bill.vertical,
    },
  ];

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: bill.billedAt,
    memo: bill.memo ?? `${bill.vendor.name} — bill ${bill.billNumber}`,
    sourceType: "bill",
    sourceId: accrualSourceId(bill.id),
    actor: args.actor,
    lines,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.bill.update({
    where: { id: bill.id },
    data: { journalEntryId: res.entryId, status: "open" },
  });
  return { ok: true, entryId: res.entryId };
}

/**
 * Pay a bill: Accounts Payable down, the bank down.
 *
 * The payment is its OWN entry, dated the day the money left — not the day the
 * bill was written. Dating it back to the bill would make the bank balance
 * disagree with the bank.
 */
export async function payBill(args: {
  companyId: string;
  billId: string;
  bankLedgerAccountId: string;
  date: Date;
  actor: PostingActor;
  /** Set when the payment was recognised from a bank feed row. */
  memo?: string | null;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const bill = await prisma.bill.findFirst({
    where: { id: args.billId, companyId: args.companyId },
    select: {
      id: true,
      status: true,
      amountCents: true,
      billNumber: true,
      projectId: true,
      vertical: true,
      vendorId: true,
      journalEntryId: true,
      vendor: { select: { name: true } },
    },
  });
  if (!bill) return { ok: false, error: "That bill is not on this company." };
  if (bill.status === "paid") return { ok: false, error: "This bill is already paid." };
  if (bill.status === "void") return { ok: false, error: "This bill has been voided." };
  if (!bill.journalEntryId) {
    return { ok: false, error: "Post this bill to the books before paying it." };
  }

  const lines: JournalLineInput[] = [
    {
      systemKey: "accounts_payable",
      debitCents: bill.amountCents,
      projectId: bill.projectId,
      vendorId: bill.vendorId,
      vertical: bill.vertical,
    },
    { accountId: args.bankLedgerAccountId, creditCents: bill.amountCents, projectId: bill.projectId },
  ];

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: args.date,
    memo: args.memo ?? `Payment — ${bill.vendor.name} bill ${bill.billNumber}`,
    sourceType: "bill_payment",
    sourceId: paymentSourceId(bill.id),
    actor: args.actor,
    lines,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.bill.update({
    where: { id: bill.id },
    data: { status: "paid", paidAt: args.date },
  });
  return { ok: true, entryId: res.entryId };
}

/**
 * Void a bill by reversing its accrual. Never a delete.
 *
 * A paid bill cannot be voided: the money has moved, and the honest correction
 * is to record what actually happened (a refund, a credit note) rather than to
 * erase a payment that the bank statement still shows.
 */
export async function voidBill(args: {
  companyId: string;
  billId: string;
  reason: string;
  actor: PostingActor;
}): Promise<{ ok: true; reversalId: string | null } | { ok: false; error: string }> {
  if (!args.reason.trim()) return { ok: false, error: "Say why this bill is being voided." };

  const bill = await prisma.bill.findFirst({
    where: { id: args.billId, companyId: args.companyId },
    select: { id: true, status: true, journalEntryId: true },
  });
  if (!bill) return { ok: false, error: "That bill is not on this company." };
  if (bill.status === "void") return { ok: false, error: "This bill is already void." };
  if (bill.status === "paid") {
    return {
      ok: false,
      error: "This bill has been paid. Record a refund or a credit note rather than voiding it.",
    };
  }

  let reversalId: string | null = null;
  if (bill.journalEntryId) {
    const res = await voidJournalEntry({
      companyId: args.companyId,
      entryId: bill.journalEntryId,
      reason: args.reason,
      actor: args.actor,
    });
    if (!res.ok) return { ok: false, error: res.error };
    reversalId = res.entryId;
  }

  await prisma.bill.update({ where: { id: bill.id }, data: { status: "void" } });
  return { ok: true, reversalId };
}

/**
 * A/P uses the shared aging buckets, so what we owe and what we are owed can
 * never drift apart on where "31–60" ends. The name is kept as an alias so
 * callers that already speak in A/P terms read naturally.
 */
export type ApAgingBucket = AgingBucket;

export type ApAgingRow = {
  billId: string;
  vendorName: string;
  billNumber: string;
  dueAt: string | null;
  daysOver: number;
  bucket: ApAgingBucket;
  amountCents: number;
};

/**
 * What we owe, by how late it is.
 *
 * Bucketed on the DUE date, and a bill with no due date is "Current" rather
 * than infinitely overdue — no due date means no terms were recorded, not that
 * payment was due the day it arrived.
 *
 * Only `open` bills: a draft is not a debt and a paid one is not outstanding.
 */
export async function apAging(
  companyId: string,
  asOf: Date = new Date()
): Promise<{ rows: ApAgingRow[]; totals: Record<ApAgingBucket, number>; totalCents: number }> {
  const bills = await prisma.bill.findMany({
    where: { companyId, status: "open" },
    orderBy: [{ dueAt: "asc" }],
    select: {
      id: true,
      billNumber: true,
      amountCents: true,
      dueAt: true,
      vendor: { select: { name: true } },
    },
  });

  const totals = emptyBucketTotals();

  const rows = bills.map((b): ApAgingRow => {
    const daysOver = daysOverdue(b.dueAt, asOf);
    const bucket = bucketFor(daysOver);
    totals[bucket] += b.amountCents;
    return {
      billId: b.id,
      vendorName: b.vendor.name,
      billNumber: b.billNumber,
      dueAt: b.dueAt ? b.dueAt.toISOString() : null,
      daysOver: Math.max(0, daysOver),
      bucket,
      amountCents: b.amountCents,
    };
  });

  return { rows, totals, totalCents: rows.reduce((s, r) => s + r.amountCents, 0) };
}
