import { prisma } from "@/server/db/client";
import { runUnscoped } from "@/server/vertical/context";
import type { PostingActor } from "@/server/modules/books/posting";
import { receiveInvoicePayment } from "@/server/modules/books/invoices";
import { payBill } from "@/server/modules/books/bills";
import { recogniseFunding } from "@/server/modules/books/funding";
import { loadDecidable } from "./review";

/**
 * SETTLING SOMETHING THE BOOKS ARE ALREADY WAITING FOR.
 *
 * The review queue had two answers for a bank row: categorise it into accounts
 * (`acceptFeedTransaction`), or link it to an entry we had already posted
 * (`matchFeedTransaction`). Neither fits the commonest case in this business —
 * the money arriving IS an invoice being collected, a bill being paid, or a
 * lender funding a deal, and the books are already carrying the open item.
 *
 * Categorising such a row would post revenue a second time and leave the
 * receivable open forever. Matching cannot help either, because the settling
 * entry does not exist yet. So this is the third answer: create the settlement
 * through the module that owns it, then link the row to what it produced.
 *
 * ── DIRECTION IS CHECKED, NOT ASSUMED ───────────────────────────────────────
 * A deposit cannot pay a bill and a withdrawal cannot collect an invoice.
 * Without this guard a mis-click books a payment that moves the bank the wrong
 * way, and the entry still balances — so nothing downstream can catch it.
 *
 * ── THE AMOUNT MUST BE THE AMOUNT ───────────────────────────────────────────
 * `receiveInvoicePayment` and `payBill` settle in full, at the item's own
 * amount. If the bank says $4,000 and the invoice says $4,200, posting anyway
 * would move a different amount through the bank account than the bank
 * reported, and the reconciliation would never tie out. That is refused here
 * rather than absorbed, for the same reason `matchFeedTransaction` insists an
 * entry actually touches this account for this amount.
 *
 * Lender funding is the deliberate exception: a deposit that differs from the
 * expectation is the NORMAL case, and the gap is posted to Dealer Fees or
 * Funding Variance by `recogniseFunding`. So the bank's figure is passed
 * through as the amount received rather than compared to anything.
 *
 * ── LINKING IS DONE HERE ────────────────────────────────────────────────────
 * `recogniseFunding` writes `bankFeedTransactionId` onto the LenderFunding row,
 * but nothing updates the feed row itself. Left to it, the money would be in
 * the books while the queue still showed the row awaiting a decision.
 */

export type SettlementTarget =
  | { kind: "invoice"; invoiceId: string }
  | { kind: "bill"; billId: string }
  | { kind: "funding"; fundingId: string };

export type SettlementResult =
  | { ok: true; entryId: string; varianceCents?: number }
  | { ok: false; error: string };

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export async function settleFromFeed(args: {
  companyId: string;
  feedTransactionId: string;
  target: SettlementTarget;
  actor: PostingActor;
  memo?: string | null;
}): Promise<SettlementResult> {
  const loaded = await loadDecidable(args.companyId, args.feedTransactionId);
  if (!loaded.ok) return loaded;
  const { row, ledgerAccountId } = loaded;

  const moneyOut = row.amountCents < 0;
  const magnitude = Math.abs(row.amountCents);
  const memo = args.memo ?? row.merchantName ?? row.description;

  // Hoisted to a local const so the discriminated-union narrowing below survives
  // into the callbacks. Narrowing a property access (`args.target`) does not.
  const target = args.target;

  if (target.kind === "bill" && !moneyOut) {
    return { ok: false, error: "This is money arriving. A bill is paid with money leaving." };
  }
  if (target.kind !== "bill" && moneyOut) {
    return {
      ok: false,
      error:
        target.kind === "invoice"
          ? "This is money leaving. An invoice is collected with money arriving."
          : "This is money leaving. A lender funding is money arriving.",
    };
  }

  let entryId: string;
  let varianceCents: number | undefined;

  if (target.kind === "invoice") {
    const invoice = await runUnscoped("bank feed: settle an invoice from a deposit", () =>
      prisma.invoice.findFirst({
        where: { id: target.invoiceId, companyId: args.companyId },
        select: { amount: true },
      })
    );
    if (!invoice) return { ok: false, error: "That invoice is not on this company." };
    if (invoice.amount !== magnitude) {
      return {
        ok: false,
        error: `The bank shows ${money(magnitude)} but this invoice is ${money(invoice.amount)}. Record a part payment against the invoice instead.`,
      };
    }

    const res = await receiveInvoicePayment({
      companyId: args.companyId,
      invoiceId: target.invoiceId,
      bankLedgerAccountId: ledgerAccountId,
      date: row.postedAt,
      actor: args.actor,
      memo,
    });
    if (!res.ok) return res;
    entryId = res.entryId;
  } else if (target.kind === "bill") {
    const bill = await prisma.bill.findFirst({
      where: { id: target.billId, companyId: args.companyId },
      select: { amountCents: true },
    });
    if (!bill) return { ok: false, error: "That bill is not on this company." };
    if (bill.amountCents !== magnitude) {
      return {
        ok: false,
        error: `The bank shows ${money(magnitude)} but this bill is ${money(bill.amountCents)}. Record a part payment against the bill instead.`,
      };
    }

    const res = await payBill({
      companyId: args.companyId,
      billId: target.billId,
      bankLedgerAccountId: ledgerAccountId,
      date: row.postedAt,
      actor: args.actor,
      memo,
    });
    if (!res.ok) return res;
    entryId = res.entryId;
  } else {
    // The bank's figure IS the amount received. A gap against the expectation
    // is ordinary and is posted as variance by the funding module.
    const res = await recogniseFunding({
      companyId: args.companyId,
      fundingId: target.fundingId,
      bankLedgerAccountId: ledgerAccountId,
      receivedCents: magnitude,
      date: row.postedAt,
      actor: args.actor,
      feedTransactionId: row.id,
      memo,
    });
    if (!res.ok) return res;
    entryId = res.entryId;
    varianceCents = res.varianceCents;
  }

  await prisma.bankFeedTransaction.update({
    where: { id: row.id },
    data: {
      status: "posted",
      journalEntryId: entryId,
      decidedAt: new Date(),
      decidedById: args.actor.kind === "user" ? args.actor.userId : null,
    },
  });

  return varianceCents === undefined ? { ok: true, entryId } : { ok: true, entryId, varianceCents };
}

/**
 * What a bank row could plausibly be settling.
 *
 * Offered as a LIST, never as a decision. The caller shows these as choices and
 * a person picks; nothing here auto-settles. An invoice and a bill can match
 * the same figure on the same day, and guessing between them books money
 * against the wrong party in a way that looks entirely normal afterwards.
 *
 * Matched on the exact amount, because an invoice is settled in full here.
 * Funding candidates come from the funding module, which applies each lender's
 * own tolerance.
 */
export async function settlementCandidatesFor(args: {
  companyId: string;
  amountCents: number;
}): Promise<{
  invoices: { id: string; invoiceNumber: string; amountCents: number; customerName: string }[];
  bills: { id: string; billNumber: string; amountCents: number; vendorName: string }[];
}> {
  const magnitude = Math.abs(args.amountCents);
  if (magnitude <= 0) return { invoices: [], bills: [] };

  // Money in can only be settling a receivable; money out, a payable. Offering
  // both regardless would invite exactly the mis-posting the direction guard
  // above refuses.
  const moneyOut = args.amountCents < 0;

  const invoices = moneyOut
    ? []
    : await runUnscoped("bank feed: which invoices could this deposit be settling", () =>
        prisma.invoice.findMany({
          where: { companyId: args.companyId, status: "sent", amount: magnitude },
          orderBy: [{ dueAt: "asc" }],
          take: 20,
          select: {
            id: true,
            invoiceNumber: true,
            amount: true,
            project: { select: { lead: { select: { firstName: true, lastName: true } } } },
          },
        })
      );

  const bills = moneyOut
    ? await prisma.bill.findMany({
        where: { companyId: args.companyId, status: "open", amountCents: magnitude },
        orderBy: [{ dueAt: "asc" }],
        take: 20,
        select: { id: true, billNumber: true, amountCents: true, vendor: { select: { name: true } } },
      })
    : [];

  return {
    invoices: invoices.map((iv) => {
      const lead = iv.project?.lead;
      return {
        id: iv.id,
        invoiceNumber: iv.invoiceNumber,
        amountCents: iv.amount,
        customerName: lead ? `${lead.firstName} ${lead.lastName}`.trim() : "—",
      };
    }),
    bills: bills.map((b) => ({
      id: b.id,
      billNumber: b.billNumber,
      amountCents: b.amountCents,
      vendorName: b.vendor.name,
    })),
  };
}
