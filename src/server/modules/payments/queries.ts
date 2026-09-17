import type { PaymentMethod, PaymentStatus } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { mfaStatus, type MfaStatus } from "@/server/auth/mfa";
import { listPayees, type PayeeRow } from "./payees";
import { dailyLimitCents, singlePaymentLimitCents } from "./payments";

/**
 * WHAT THE PAYMENTS SCREEN READS.
 *
 * Mirrors bank-feeds/queries.ts: one overview type, assembled in one place, so
 * the page stays a gate and the client component stays presentation.
 *
 * TWO THINGS ARE DELIBERATELY ABSENT FROM EVERY TYPE HERE.
 *
 * `approvalMfaStep` is a BigInt. BigInt does not survive the server/client
 * boundary — React cannot serialise it — so a row carrying it would fail at
 * render rather than at compile. It is also nobody's business on a screen: it
 * exists so a code cannot be replayed.
 *
 * And the payee's bank details. `listPayees` never selects the encrypted
 * columns at all, which is stronger than selecting and dropping them: a field
 * that is never loaded cannot be logged by accident or leaked by a future
 * caller spreading the row into a response. Only the masked tail reaches here.
 *
 * Dates cross as ISO strings for the same serialisation reason.
 */

/** The live states — a bill with a payment in any of these is already covered. */
const LIVE_PAYMENT_STATUSES: PaymentStatus[] = ["draft", "submitted", "approved", "sent", "settled"];

const ALL_PAYMENT_STATUSES: PaymentStatus[] = [
  "draft",
  "submitted",
  "approved",
  "sent",
  "settled",
  "returned",
  "failed",
  "cancelled",
];

export type PaymentRow = {
  id: string;
  payeeId: string;
  payeeName: string;
  accountLast4: string | null;
  billId: string | null;
  billNumber: string | null;
  vendorName: string | null;
  amountCents: number;
  status: PaymentStatus;
  method: PaymentMethod;
  memo: string | null;
  bankAccountName: string | null;
  /** Who raised it and who approved it — the maker-checker pair, by name. */
  createdByName: string | null;
  approvedByName: string | null;
  /** True when the viewer raised this one, so the screen can say why it cannot approve it. */
  raisedByViewer: boolean;
  submittedAt: string | null;
  approvedAt: string | null;
  sentAt: string | null;
  settledAt: string | null;
  returnedAt: string | null;
  returnCode: string | null;
  returnReason: string | null;
  createdAt: string;
};

/**
 * A bill a payment may actually be raised against.
 *
 * The filter mirrors `createPayment`'s own checks rather than listing every
 * bill: offering one that will be refused turns a validation rule into a dead
 * end the person discovers after filling in the form.
 */
export type PayableBill = {
  id: string;
  billNumber: string;
  vendorName: string;
  amountCents: number;
  dueAt: string | null;
};

export type PaymentsOverview = {
  payments: PaymentRow[];
  payees: PayeeRow[];
  payableBills: PayableBill[];
  bankAccounts: { id: string; name: string; mask: string | null; kind: string }[];
  limits: { singleCents: number; dailyCents: number };
  /** The VIEWER's second factor. Nothing can be approved without one. */
  mfa: MfaStatus;
  counts: Record<PaymentStatus, number>;
  /** What today's approved-and-sent total already uses up of the daily limit. */
  sentTodayCents: number;
};

const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

export async function getPaymentsOverview(
  companyId: string,
  viewerUserId: string
): Promise<PaymentsOverview> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);

  const [payments, payees, openBills, bankAccounts, grouped, mfa, sentToday] = await Promise.all([
    prisma.payment.findMany({
      where: { companyId },
      orderBy: [{ createdAt: "desc" }],
      take: 200,
      // Selected field by field, never the whole row: `approvalMfaStep` is a
      // BigInt that cannot be serialised to the client.
      select: {
        id: true,
        payeeId: true,
        billId: true,
        amountCents: true,
        status: true,
        method: true,
        memo: true,
        createdById: true,
        approvedById: true,
        submittedAt: true,
        approvedAt: true,
        sentAt: true,
        settledAt: true,
        returnedAt: true,
        returnCode: true,
        returnReason: true,
        createdAt: true,
        payee: { select: { name: true, accountLast4: true } },
        bill: { select: { billNumber: true, vendor: { select: { name: true } } } },
        bankAccount: { select: { name: true } },
      },
    }),
    listPayees(companyId),
    prisma.bill.findMany({
      where: {
        companyId,
        status: "open",
        // An unposted bill cannot be paid — createPayment refuses it.
        journalEntryId: { not: null },
      },
      orderBy: [{ dueAt: "asc" }],
      select: {
        id: true,
        billNumber: true,
        amountCents: true,
        dueAt: true,
        vendor: { select: { name: true } },
      },
    }),
    prisma.bankAccount.findMany({
      where: { companyId, active: true },
      orderBy: { name: "asc" },
      select: { id: true, name: true, mask: true, kind: true },
    }),
    // Counts come from an aggregate over EVERY row, never from the capped list
    // above: summing a truncated page is how a total silently under-reports.
    prisma.payment.groupBy({
      by: ["status"],
      where: { companyId },
      _count: { _all: true },
    }),
    mfaStatus(viewerUserId),
    prisma.payment.aggregate({
      where: { companyId, sentAt: { gte: startOfToday } },
      _sum: { amountCents: true },
    }),
  ]);

  // Which bills already have something live against them. Done as a second pass
  // rather than through a relation filter so the rule reads the same way here as
  // it does in createPayment, which is the thing that will actually refuse.
  const covered = new Set(
    (
      await prisma.payment.findMany({
        where: { companyId, status: { in: LIVE_PAYMENT_STATUSES }, billId: { not: null } },
        select: { billId: true },
      })
    ).flatMap((p) => (p.billId ? [p.billId] : []))
  );

  // Names for the maker and the checker. Payment holds plain ids, not relations,
  // so they are resolved in one lookup rather than per row.
  const userIds = [
    ...new Set(
      payments.flatMap((p) => [p.createdById, p.approvedById].filter((v): v is string => !!v))
    ),
  ];
  const users = userIds.length
    ? await prisma.user.findMany({
        where: { id: { in: userIds }, companyId },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim()]));

  const counts = Object.fromEntries(ALL_PAYMENT_STATUSES.map((s) => [s, 0])) as Record<
    PaymentStatus,
    number
  >;
  for (const g of grouped) counts[g.status] = g._count._all;

  return {
    payments: payments.map((p) => ({
      id: p.id,
      payeeId: p.payeeId,
      payeeName: p.payee.name,
      accountLast4: p.payee.accountLast4,
      billId: p.billId,
      billNumber: p.bill?.billNumber ?? null,
      vendorName: p.bill?.vendor?.name ?? null,
      amountCents: p.amountCents,
      status: p.status,
      method: p.method,
      memo: p.memo,
      bankAccountName: p.bankAccount?.name ?? null,
      createdByName: p.createdById ? nameById.get(p.createdById) ?? null : null,
      approvedByName: p.approvedById ? nameById.get(p.approvedById) ?? null : null,
      raisedByViewer: p.createdById === viewerUserId,
      submittedAt: iso(p.submittedAt),
      approvedAt: iso(p.approvedAt),
      sentAt: iso(p.sentAt),
      settledAt: iso(p.settledAt),
      returnedAt: iso(p.returnedAt),
      returnCode: p.returnCode,
      returnReason: p.returnReason,
      createdAt: p.createdAt.toISOString(),
    })),
    payees,
    payableBills: openBills
      .filter((b) => !covered.has(b.id))
      .map((b) => ({
        id: b.id,
        billNumber: b.billNumber,
        vendorName: b.vendor?.name ?? "—",
        amountCents: b.amountCents,
        dueAt: iso(b.dueAt),
      })),
    bankAccounts,
    limits: { singleCents: singlePaymentLimitCents(), dailyCents: dailyLimitCents() },
    mfa,
    counts,
    sentTodayCents: sentToday._sum.amountCents ?? 0,
  };
}
