import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader } from "@/components/portal/ui";
import { RenderableReportView } from "@/components/portal/renderable-report";
import { StatementControls } from "@/components/portal/statement-controls";
import { solarVerticalEnabled } from "@/server/vertical/flag";
import { STATEMENT_META, ledgerAccountOptions } from "@/server/modules/books/statements";
import {
  buildStatement,
  isStatementSlug,
  paramsFrom,
  requestQuery,
  resolveStatementRequest,
} from "@/server/modules/books/statement-request";

/**
 * The financial statements.
 *
 * Gated on `Bookkeeping`, NOT on `Report`. That is the whole point of the
 * resource split made in Phase 3: `Report` is the reports hub, which is mostly
 * the sales floor, and the outside CPA must reach the statements without
 * reaching that. See the comment on `accountant_readonly` in rbac/matrix.ts.
 */
export async function generateMetadata({ params }: { params: Promise<{ statement: string }> }) {
  const { statement } = await params;
  return { title: isStatementSlug(statement) ? STATEMENT_META[statement].title : "Statement" };
}

export default async function StatementPage({
  params,
  searchParams,
}: {
  params: Promise<{ statement: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { statement } = await params;
  if (!isStatementSlug(statement)) notFound();

  const user = await requireUser();
  if (!can(user, "read", "Bookkeeping")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const req = resolveStatementRequest(statement, paramsFrom(sp));

  // Only the register needs the account list, and it is the one statement that
  // cannot render without it — so it is loaded for that case alone rather than
  // on every statement.
  const accountOptions = statement === "general-ledger" ? await ledgerAccountOptions(user.companyId) : [];
  const accountLabel = accountOptions.find((a) => a.value === req.accountId)?.label;

  const report = await buildStatement(user.companyId, req, accountLabel);
  const meta = STATEMENT_META[statement];

  /**
   * The department filter is a CHOICE made on this page, deliberately separate
   * from the workspace switcher. There is one consolidated general ledger by
   * design (books-build.md, "One set of books, split by vertical"), so a
   * statement must be able to show the whole company — which the workspace
   * switcher, whose job is to show one vertical at a time, cannot express.
   */
  const verticalOptions = solarVerticalEnabled()
    ? [
        { value: "", label: "All departments" },
        { value: "roofing", label: "Roofing" },
        { value: "solar", label: "Solar" },
        { value: "others", label: "Other" },
      ]
    : [];

  return (
    <div className="space-y-6">
      <Link
        href="/portal/books"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Back to the books
      </Link>

      <PageHeader title={meta.title} description={meta.description} />

      <StatementControls
        basePath={`/portal/books/statements/${statement}`}
        preset={req.preset}
        from={req.from}
        to={req.to}
        basis={req.basis}
        comparison={req.comparison}
        vertical={req.vertical ?? ""}
        account={req.accountId ?? ""}
        accountOptions={accountOptions}
        verticalOptions={verticalOptions}
        // A trial balance has no cash basis: a cash-basis subset of entries
        // does not balance and is not meant to.
        showBasis={statement === "profit-and-loss"}
        showComparison={statement === "profit-and-loss"}
        showPeriod={statement === "profit-and-loss" || statement === "general-ledger"}
        showAccount={statement === "general-ledger"}
        query={requestQuery(req)}
        blurb={`${report.periodLabel} · ${report.scopeLabel}`}
      />

      <RenderableReportView report={report} />
    </div>
  );
}
