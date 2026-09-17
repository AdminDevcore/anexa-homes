import type { InvoiceStatus, Vertical } from "@prisma/client";
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
 * CUSTOMER INVOICES — what we are owed, from the day we billed it.
 *
 * ── THE MISSING HALF OF THE LEDGER ──────────────────────────────────────────
 * `chart.ts` describes Accounts Receivable as "posted by invoices", and until
 * now nothing posted it. The consequence was visible in the funding tests:
 * recognising a lender deposit CREDITS A/R, and with nothing ever debiting it,
 * A/R ran NEGATIVE — the balance sheet claimed customers owed us less than
 * nothing. This module is the debit side.
 *
 *   issued     Accounts Receivable  →  revenue (tagged to the job)
 *   paid       the bank             →  Accounts Receivable
 *
 * Two events, for the same reason bills have two: work invoiced in March is
 * March revenue even when the cheque clears in May. Booking revenue only on
 * payment would make a company that has invoiced $200,000 and collected none
 * of it look like it earned nothing.
 *
 * ── WHICH REVENUE ACCOUNT ───────────────────────────────────────────────────
 * Revenue is split by department (`roofing_revenue`, `solar_revenue`), so the
 * credit follows the JOB's vertical rather than whoever happens to be logged
 * in. `Project.vertical` is non-null and `Invoice.projectId` is required, so
 * there is always an answer; a vertical with no revenue account configured is
 * an error rather than a guess, because quietly booking solar revenue as
 * roofing produces a P&L that splits wrongly and reconciles perfectly.
 *
 * ── WHY THE READS ARE UNSCOPED ──────────────────────────────────────────────
 * `Project` is vertical-scoped and the books are not. An invoice is asked
 * about from the Books screen, a bank-feed match and a statement run, none of
 * which have a workspace selected. Every call still filters by companyId; the
 * vertical tag on the row is set from the job, not from the reader.
 *
 * ── SOURCE KEYS ─────────────────────────────────────────────────────────────
 * `invoice:<id>` and `invoice:<id>:payment`, matching the bill convention.
 * They become the entry's uniquely-constrained (sourceType, sourceId), so a
 * retry after a half-finished write cannot book either event twice.
 */

const accrualSourceId = (invoiceId: string) => `invoice:${invoiceId}`;
const paymentSourceId = (invoiceId: string) => `invoice:${invoiceId}:payment`;

/** Revenue is departmental. A vertical absent from this map has no revenue
 * account in the chart, and the caller must name one explicitly. */
const REVENUE_KEY_BY_VERTICAL: Partial<Record<Vertical, string>> = {
  roofing: "roofing_revenue",
  solar: "solar_revenue",
};

export type InvoiceResult =
  | { ok: true; invoiceId: string; entryId: string | null }
  | { ok: false; error: string };

export type CreateInvoiceInput = {
  companyId: string;
  /** Required by the schema: an invoice always belongs to a job. */
  projectId: string;
  invoiceNumber: string;
  amountCents: number;
  /** The date the customer was billed — NOT the date this row was typed. */
  issuedAt: Date;
  dueAt?: Date | null;
  /** Override the departmental default. A system key is resolved by posting. */
  revenueAccountId?: string | null;
  revenueSystemKey?: string | null;
  notes?: string | null;
  /** A draft is recorded but not posted. */
  status?: Extract<InvoiceStatus, "draft" | "sent">;
  actor: PostingActor;
};

/**
 * Raise an invoice, and post it to A/R unless it is a draft.
 *
 * The row and its entry are written in that order rather than in one
 * transaction, deliberately: `postJournalEntry` is the only door to the ledger
 * and runs its own transaction with its own period-lock and reference checks.
 * An invoice whose posting fails keeps `journalEntryId` null and returns the
 * error — visible and re-postable — as against nesting two competing
 * transaction scopes around the same rows.
 */
export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceResult> {
  const status = input.status ?? "sent";
  const invoiceNumber = input.invoiceNumber.trim();

  if (!Number.isInteger(input.amountCents) || input.amountCents <= 0) {
    return { ok: false, error: "An invoice must be a positive whole number of cents." };
  }
  if (!invoiceNumber) {
    return { ok: false, error: "Give the invoice a number." };
  }
  if (!(input.issuedAt instanceof Date) || Number.isNaN(input.issuedAt.getTime())) {
    return { ok: false, error: "Give the invoice an issue date." };
  }

  const project = await runUnscoped("books: an invoice belongs to a job in any workspace", () =>
    prisma.project.findFirst({
      where: { id: input.projectId, companyId: input.companyId },
      select: { id: true, vertical: true },
    })
  );
  if (!project) return { ok: false, error: "That job is not on this company." };

  // Resolved here rather than at posting time so an unconfigured department
  // fails before a row is written, not after.
  const revenue = revenueTargetFor({
    vertical: project.vertical,
    accountId: input.revenueAccountId,
    systemKey: input.revenueSystemKey,
  });
  if (!revenue.ok) return { ok: false, error: revenue.error };

  // Checked here for a readable error. The unique index is what actually
  // guarantees it — two requests can pass this check at the same moment.
  const clash = await prisma.invoice.findFirst({
    where: { companyId: input.companyId, invoiceNumber },
    select: { id: true },
  });
  if (clash) return { ok: false, error: `Invoice ${invoiceNumber} already exists.` };

  const invoice = await prisma.invoice.create({
    data: {
      companyId: input.companyId,
      projectId: project.id,
      invoiceNumber,
      status,
      // Tagged from the JOB, explicitly. The vertical extension can derive this
      // from `projectId`, but that derivation reads a vertical-scoped Project
      // and resolves to null when there is no ambient workspace — which is the
      // normal case for the books. We already read the job to pick the revenue
      // account, so the department is stated from the same authoritative value
      // rather than left to a lookup that can quietly return nothing.
      vertical: project.vertical,
      amount: input.amountCents,
      issuedAt: input.issuedAt,
      dueAt: input.dueAt ?? null,
      notes: input.notes ?? null,
    },
    select: { id: true },
  });

  if (status === "draft") return { ok: true, invoiceId: invoice.id, entryId: null };

  const posted = await postInvoiceAccrual({
    companyId: input.companyId,
    invoiceId: invoice.id,
    revenueAccountId: input.revenueAccountId,
    revenueSystemKey: input.revenueSystemKey,
    actor: input.actor,
  });
  if (!posted.ok) return { ok: false, error: posted.error };

  return { ok: true, invoiceId: invoice.id, entryId: posted.entryId };
}

/**
 * Post an invoice to the books: A/R up, revenue up.
 *
 * Separate from `createInvoice` so a draft can be issued later without being
 * re-entered, and so a failed posting can be retried against the existing row.
 */
export async function postInvoiceAccrual(args: {
  companyId: string;
  invoiceId: string;
  revenueAccountId?: string | null;
  revenueSystemKey?: string | null;
  actor: PostingActor;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const invoice = await runUnscoped("books: invoices are company-wide", () =>
    prisma.invoice.findFirst({
      where: { id: args.invoiceId, companyId: args.companyId },
      select: {
        id: true,
        status: true,
        amount: true,
        issuedAt: true,
        invoiceNumber: true,
        projectId: true,
        vertical: true,
        journalEntryId: true,
        notes: true,
        project: { select: { vertical: true } },
      },
    })
  );
  if (!invoice) return { ok: false, error: "That invoice is not on this company." };
  if (invoice.journalEntryId) return { ok: false, error: "This invoice is already in the books." };
  if (invoice.status === "void") return { ok: false, error: "This invoice has been voided." };

  const revenue = revenueTargetFor({
    vertical: invoice.project.vertical,
    accountId: args.revenueAccountId,
    systemKey: args.revenueSystemKey,
  });
  if (!revenue.ok) return { ok: false, error: revenue.error };

  // An invoice row written before this module tagged them explicitly can still
  // have a null vertical. Fall back to the job's, so the P&L splits correctly
  // either way rather than silently booking the line to no department.
  const vertical = invoice.vertical ?? invoice.project.vertical;

  const lines: JournalLineInput[] = [
    {
      systemKey: "accounts_receivable",
      debitCents: invoice.amount,
      projectId: invoice.projectId,
      vertical,
    },
    {
      ...revenue.line,
      creditCents: invoice.amount,
      projectId: invoice.projectId,
      vertical,
    },
  ];

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: invoice.issuedAt,
    memo: invoice.notes ?? `Invoice ${invoice.invoiceNumber}`,
    sourceType: "invoice",
    sourceId: accrualSourceId(invoice.id),
    actor: args.actor,
    lines,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { journalEntryId: res.entryId, status: "sent" },
  });
  return { ok: true, entryId: res.entryId };
}

/**
 * Collect an invoice: the bank up, Accounts Receivable down.
 *
 * Its own entry, dated the day the money ARRIVED — not the day we billed.
 * Dating it back to the invoice would make the bank balance disagree with the
 * bank statement, which is the one number a reconciliation cannot argue with.
 *
 * Full settlement only, matching bills. A part payment is a real thing that
 * this deliberately does not pretend to handle: splitting one invoice across
 * several receipts needs its own applied-amount record, and faking it by
 * marking the whole invoice paid would overstate collections.
 */
export async function receiveInvoicePayment(args: {
  companyId: string;
  invoiceId: string;
  bankLedgerAccountId: string;
  date: Date;
  actor: PostingActor;
  /** Set when the receipt was recognised from a bank feed row. */
  memo?: string | null;
}): Promise<{ ok: true; entryId: string } | { ok: false; error: string }> {
  const invoice = await runUnscoped("books: invoices are company-wide", () =>
    prisma.invoice.findFirst({
      where: { id: args.invoiceId, companyId: args.companyId },
      select: {
        id: true,
        status: true,
        amount: true,
        invoiceNumber: true,
        projectId: true,
        vertical: true,
        journalEntryId: true,
        project: { select: { vertical: true } },
      },
    })
  );
  if (!invoice) return { ok: false, error: "That invoice is not on this company." };
  if (invoice.status === "paid") return { ok: false, error: "This invoice is already paid." };
  if (invoice.status === "void") return { ok: false, error: "This invoice has been voided." };
  if (!invoice.journalEntryId) {
    return { ok: false, error: "Post this invoice to the books before collecting it." };
  }

  const lines: JournalLineInput[] = [
    { accountId: args.bankLedgerAccountId, debitCents: invoice.amount, projectId: invoice.projectId },
    {
      systemKey: "accounts_receivable",
      creditCents: invoice.amount,
      projectId: invoice.projectId,
      vertical: invoice.vertical ?? invoice.project.vertical,
    },
  ];

  const res = await postJournalEntry({
    companyId: args.companyId,
    date: args.date,
    memo: args.memo ?? `Payment received — invoice ${invoice.invoiceNumber}`,
    sourceType: "invoice_payment",
    sourceId: paymentSourceId(invoice.id),
    actor: args.actor,
    lines,
  });
  if (!res.ok) return { ok: false, error: res.error };

  await prisma.invoice.update({
    where: { id: invoice.id },
    data: { status: "paid", paidAt: args.date },
  });
  return { ok: true, entryId: res.entryId };
}

/**
 * Void an invoice by reversing it. Never a delete.
 *
 * A paid invoice cannot be voided: the money arrived, and the honest
 * correction is a credit note or a refund that records what actually happened,
 * rather than erasing a receipt the bank statement still shows.
 */
export async function voidInvoice(args: {
  companyId: string;
  invoiceId: string;
  reason: string;
  actor: PostingActor;
}): Promise<{ ok: true; reversalId: string | null } | { ok: false; error: string }> {
  if (!args.reason.trim()) return { ok: false, error: "Say why this invoice is being voided." };

  const invoice = await runUnscoped("books: invoices are company-wide", () =>
    prisma.invoice.findFirst({
      where: { id: args.invoiceId, companyId: args.companyId },
      select: { id: true, status: true, journalEntryId: true },
    })
  );
  if (!invoice) return { ok: false, error: "That invoice is not on this company." };
  if (invoice.status === "void") return { ok: false, error: "This invoice is already void." };
  if (invoice.status === "paid") {
    return {
      ok: false,
      error: "This invoice has been paid. Record a refund or a credit note rather than voiding it.",
    };
  }

  let reversalId: string | null = null;
  if (invoice.journalEntryId) {
    const res = await voidJournalEntry({
      companyId: args.companyId,
      entryId: invoice.journalEntryId,
      reason: args.reason,
      actor: args.actor,
    });
    if (!res.ok) return { ok: false, error: res.error };
    reversalId = res.entryId;
  }

  await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "void" } });
  return { ok: true, reversalId };
}

function revenueTargetFor(args: {
  vertical: Vertical;
  accountId?: string | null;
  systemKey?: string | null;
}): { ok: true; line: { accountId?: string; systemKey?: string } } | { ok: false; error: string } {
  if (args.accountId) return { ok: true, line: { accountId: args.accountId } };
  if (args.systemKey) return { ok: true, line: { systemKey: args.systemKey } };

  const key = REVENUE_KEY_BY_VERTICAL[args.vertical];
  if (!key) {
    return {
      ok: false,
      error: `No revenue account is configured for ${args.vertical}. Choose the account this invoice credits.`,
    };
  }
  return { ok: true, line: { systemKey: key } };
}

export type ArAgingRow = {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  projectNumber: string | null;
  dueAt: string | null;
  daysOver: number;
  bucket: AgingBucket;
  amountCents: number;
};

/**
 * What we are owed, by how late it is — the accountant's copy.
 *
 * This is cent-exact and gated on Bookkeeping. `reports/ar-aging.ts` is the
 * sales-floor copy: whole dollars, gated on Report, and deliberately left
 * alone. They are not duplicates — an outside CPA must be able to read the
 * receivables schedule without being handed the entire sales pipeline, which
 * is exactly what the Report resource carries.
 *
 * Only `sent` invoices: a draft is not a receivable and a paid one is not
 * outstanding.
 */
export async function arAging(
  companyId: string,
  asOf: Date = new Date()
): Promise<{ rows: ArAgingRow[]; totals: Record<AgingBucket, number>; totalCents: number }> {
  const invoices = await runUnscoped("books: receivables are company-wide", () =>
    prisma.invoice.findMany({
      where: { companyId, status: "sent" },
      orderBy: [{ dueAt: "asc" }],
      select: {
        id: true,
        invoiceNumber: true,
        amount: true,
        dueAt: true,
        project: {
          select: {
            projectNumber: true,
            lead: { select: { firstName: true, lastName: true } },
          },
        },
      },
    })
  );

  const totals = emptyBucketTotals();

  const rows = invoices.map((inv): ArAgingRow => {
    const daysOver = daysOverdue(inv.dueAt, asOf);
    const bucket = bucketFor(daysOver);
    totals[bucket] += inv.amount;
    const lead = inv.project?.lead;
    return {
      invoiceId: inv.id,
      invoiceNumber: inv.invoiceNumber,
      customerName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : "—",
      projectNumber: inv.project?.projectNumber ?? null,
      dueAt: inv.dueAt ? inv.dueAt.toISOString() : null,
      daysOver: Math.max(0, daysOver),
      bucket,
      amountCents: inv.amount,
    };
  });

  return { rows, totals, totalCents: rows.reduce((s, r) => s + r.amountCents, 0) };
}
