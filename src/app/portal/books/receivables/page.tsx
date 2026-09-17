import { redirect } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { RenderableReportView } from "@/components/portal/renderable-report";
import type { RenderableReport } from "@/server/modules/reports/builders";
import { formatCents, formatDate } from "@/lib/format";
import { arAging } from "@/server/modules/books/invoices";
import { AGING_BUCKETS } from "@/server/modules/books/aging";

export const metadata = { title: "Receivables" };

/**
 * THE RECEIVABLES SCHEDULE — the accountant's copy.
 *
 * Gated on `Bookkeeping`, and cent-exact. There is deliberately a SECOND A/R
 * aging in `reports/ar-aging.ts`, gated on `Report` and rounded to whole
 * dollars, and the two are not duplicates: an outside CPA has to be able to read
 * what the company is owed without being handed the entire sales pipeline, which
 * is what the `Report` resource carries. See the note on `arAging` in
 * books/invoices.ts.
 *
 * The as-of date lives in the URL for the same reason the statements' period
 * does: "receivables as they stood at year end" is then a link somebody can
 * send, where a date held in client state is not.
 */
export default async function ReceivablesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const raw = typeof sp.asOf === "string" ? sp.asOf : undefined;
  // Midday, so a typed calendar day is not shifted into the previous one for
  // anyone behind UTC — the same rule the write path uses.
  const parsed = raw ? new Date(`${raw}T12:00:00`) : null;
  const asOf = parsed && !Number.isNaN(parsed.getTime()) ? parsed : new Date();

  const { rows, totals, totalCents } = await arAging(user.companyId, asOf);

  const overdueCents = rows.filter((r) => r.daysOver > 0).reduce((s, r) => s + r.amountCents, 0);
  const worstDays = rows.reduce((w, r) => Math.max(w, r.daysOver), 0);

  const report: RenderableReport = {
    title: "Accounts receivable aging",
    periodLabel: `As of ${formatDate(asOf)}`,
    scopeLabel: "Every department, cent-exact",
    metrics: [
      { label: "Outstanding", value: formatCents(totalCents) },
      {
        label: "Overdue",
        value: formatCents(overdueCents),
        tone: overdueCents > 0 ? "neg" : "pos",
        hint: overdueCents > 0 ? "Past the due date" : "Nothing is past due",
      },
      { label: "Invoices", value: String(rows.length), tone: "muted" },
      {
        label: "Oldest",
        value: worstDays > 0 ? `${worstDays} days` : "—",
        tone: worstDays > 60 ? "neg" : "muted",
        hint: worstDays > 0 ? "Days past due on the latest invoice" : undefined,
      },
    ],
    tables: [
      {
        title: "By age",
        columns: ["Bucket", "Amount"],
        // Every bucket prints, including the empty ones: a bucket that vanishes
        // when it holds nothing makes two runs of the same report look different.
        rows: AGING_BUCKETS.map((b) => [b, formatCents(totals[b])]),
      },
      {
        title: "Outstanding invoices",
        columns: ["Invoice", "Job", "Customer", "Due", "Days over", "Amount"],
        rows: rows.map((r) => [
          r.invoiceNumber,
          r.projectNumber ?? "—",
          r.customerName,
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
        title="Receivables"
        description="What customers owe, by how late it is. Only invoices that have been sent — a draft is not a receivable, and a paid one is not outstanding."
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
