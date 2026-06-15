import { prisma } from "@/server/db/client";
import type { RenderableReport, ResolvedScope } from "./builders";

type ReportUser = { companyId: string; userId: string; role: string };
const usd = (cents: number) => `$${Math.round(cents / 100).toLocaleString("en-US")}`;
const DAY = 86_400_000;

const BUCKETS = ["Current", "1–30", "31–60", "61–90", "90+"] as const;
type Bucket = (typeof BUCKETS)[number];
function bucketFor(daysOver: number): Bucket {
  if (daysOver <= 0) return "Current";
  if (daysOver <= 30) return "1–30";
  if (daysOver <= 60) return "31–60";
  if (daysOver <= 90) return "61–90";
  return "90+";
}

/**
 * Accounts-receivable aging — a current snapshot of every billed-but-unpaid
 * invoice (status = sent), bucketed by how far past its due date it is. Old
 * unpaid invoices matter most, so this is intentionally not period-bound.
 */
export async function buildArAgingReport(user: ReportUser, scope: ResolvedScope): Promise<RenderableReport> {
  const now = Date.now();
  const invoices = await prisma.invoice.findMany({
    where: { companyId: user.companyId, status: "sent", ...(scope.isCompany ? {} : { project: { lead: scope.leadWhere } }) },
    select: {
      amount: true,
      dueAt: true,
      createdAt: true,
      invoiceNumber: true,
      project: { select: { projectNumber: true, lead: { select: { firstName: true, lastName: true } } } },
    },
  });

  const tally = new Map<Bucket, { count: number; amount: number }>(BUCKETS.map((b) => [b, { count: 0, amount: 0 }]));
  let total = 0, overdue = 0, worst = 0;
  const rows = invoices
    .map((inv) => {
      const due = inv.dueAt ?? inv.createdAt;
      const daysOver = Math.floor((now - due.getTime()) / DAY);
      const b = bucketFor(daysOver);
      const t = tally.get(b)!;
      t.count++; t.amount += inv.amount;
      total += inv.amount;
      if (daysOver > 0) { overdue += inv.amount; worst = Math.max(worst, daysOver); }
      const customer = inv.project?.lead ? `${inv.project.lead.firstName} ${inv.project.lead.lastName}`.trim() : "—";
      return {
        invoice: inv.invoiceNumber,
        job: inv.project?.projectNumber ?? "—",
        customer,
        due: inv.dueAt ? inv.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "—",
        daysOver,
        amount: inv.amount,
      };
    })
    .sort((a, b) => b.daysOver - a.daysOver);

  return {
    title: "A/R Collections Aging",
    periodLabel: "Current",
    scopeLabel: scope.label,
    metrics: [
      { label: "Outstanding", value: usd(total), hint: "billed, unpaid" },
      { label: "Overdue", value: usd(overdue), tone: "neg", hint: "past due date" },
      { label: "Open invoices", value: String(invoices.length) },
      { label: "Worst", value: `${worst}d`, tone: worst > 0 ? "neg" : undefined, hint: "days past due" },
    ],
    tables: [
      {
        title: "Aging summary",
        columns: ["Bucket", "Invoices", "Amount"],
        rows: [
          ...BUCKETS.map((b) => [b, tally.get(b)!.count, usd(tally.get(b)!.amount)]),
          ["Total", invoices.length, usd(total)],
        ],
      },
      {
        title: "Open invoices",
        columns: ["Invoice", "Job #", "Customer", "Due", "Days over", "Amount"],
        rows: rows.map((r) => [r.invoice, r.job, r.customer, r.due, r.daysOver > 0 ? `+${r.daysOver}` : "—", usd(r.amount)]),
      },
    ],
  };
}
