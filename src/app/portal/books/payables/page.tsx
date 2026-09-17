import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { RenderableReportView } from "@/components/portal/renderable-report";
import type { RenderableReport } from "@/server/modules/reports/builders";
import { formatCents, formatDate } from "@/lib/format";
import { apAging } from "@/server/modules/books/bills";
import { AGING_BUCKETS } from "@/server/modules/books/aging";

export const metadata = { title: "Payables" };

/**
 * THE PAYABLES SCHEDULE.
 *
 * The mirror of `/portal/books/receivables`, using the SAME bucket definitions
 * (books/aging.ts) so the two schedules can never disagree about where "31–60"
 * ends — the sort of quiet difference that stops two reports built from one
 * ledger from tying out.
 *
 * Only `open` bills: a draft is not a debt and a paid one is not outstanding.
 * A bill with no due date counts as Current, because no due date means nobody
 * recorded terms, not that payment was due the day it arrived.
 */
export default async function PayablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const raw = typeof sp.asOf === "string" ? sp.asOf : undefined;
  const parsed = raw ? new Date(`${raw}T12:00:00`) : null;
  const asOf = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  const { rows, totals, totalCents } = await apAging(user.companyId, asOf);

  const overdueCents = rows.filter((r) => r.daysOver > 0).reduce((s, r) => s + r.amountCents, 0);
  const worstDays = rows.reduce((w, r) => Math.max(w, r.daysOver), 0);

  const report: RenderableReport = {
    title: "Accounts payable aging",
    periodLabel: `As of ${formatDate(asOf)}`,
    scopeLabel: "Every department, cent-exact",
    metrics: [
      { label: "Owed", value: formatCents(totalCents) },
      {
        label: "Overdue",
        value: formatCents(overdueCents),
        tone: overdueCents > 0 ? "neg" : "pos",
        hint: overdueCents > 0 ? "Past the due date" : "Nothing is past due",
      },
      { label: "Bills", value: String(rows.length), tone: "muted" },
      {
        label: "Oldest",
        value: worstDays > 0 ? `${worstDays} days` : "—",
        tone: worstDays > 60 ? "neg" : "muted",
        hint: worstDays > 0 ? "Days past due on the latest bill" : undefined,
      },
    ],
    tables: [
      {
        title: "By age",
        columns: ["Bucket", "Amount"],
        rows: AGING_BUCKETS.map((b) => [b, formatCents(totals[b])]),
      },
      {
        title: "Open bills",
        columns: ["Bill", "Vendor", "Due", "Days over", "Amount"],
        rows: rows.map((r) => [
          r.billNumber,
          r.vendorName,
          r.dueAt ? formatDate(r.dueAt) : "—",
          r.daysOver > 0 ? r.daysOver : "—",
          formatCents(r.amountCents),
        ]),
      },
    ],
  };

  return (
    <div className="space-y-6">
      <PageHeader
        title="Payables"
        description="What the company owes vendors, by how late it is. Only bills that have been entered and accrued — a draft is not a debt."
      />

      <Link
        href="/portal/books"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Back to the books
      </Link>

      <RenderableReportView report={report} />
    </div>
  );
}
