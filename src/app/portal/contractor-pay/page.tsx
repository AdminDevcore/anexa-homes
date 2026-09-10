import { redirect } from "next/navigation";
import Link from "next/link";
import { Clock3, DollarSign, FileText, ImageIcon, ReceiptText, BarChart3 } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roles";
import { currentFormatters } from "@/lib/format-server";
import { listContractorInvoices } from "@/server/modules/contractor-pay/queries";
import { payTabCounts } from "@/server/modules/payroll/pay-tab-counts";
import { PayTabs } from "@/components/portal/pay-tabs";
import { PayStatus } from "@/components/portal/pay-status";
import { Initials } from "@/components/portal/initials";
import { ListFilter, type ListFacet } from "@/components/portal/list-filter";
import {
  ContractorPayAmount,
  ContractorPayRowActions,
  ContractorPayToolbar,
} from "@/components/portal/contractor-pay-actions";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Contractor Pay" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

/** Submitted-but-not-yet-a-payable comes first; then the road money travels. */
const STATUS_ORDER = ["submitted", "pending", "approved", "paid", "void"];

const TH = "text-xs font-medium uppercase tracking-wide text-muted-foreground";

/**
 * Contractor Pay — the crews' half of the Pay page.
 *
 * The same shape as the Commissions tab beside it, on purpose: totals across
 * the top, Generate and Approve All in the header, one row per payable, and the
 * same pending → approved → paid vocabulary, because it feeds the same payroll
 * run.
 *
 * Two things it does that Commissions does not, both forced by what an invoice
 * is. The amount is an INPUT, not a computed figure — nothing here can read a
 * PDF, so a human types what the invoice says and may correct it right up until
 * it is batched. And the invoice itself is openable HERE and only here: the job
 * it was dropped on shows that it exists and nothing more. See
 * src/lib/contractor-invoice.ts.
 *
 * Gated twice, which is not redundant: this page prints file ids, and a file id
 * is a URL. The route that serves the bytes carries the same check, so a copied
 * link is refused even though it never appeared in a list.
 */
export default async function ContractorPayPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "ContractorInvoice")) redirect("/portal/dashboard");

  const canManage = can(user, "update", "ContractorInvoice");
  // Searched in the browser, like the Commissions tab: the query never narrowed
  // the fetch anyway — every invoice is on the page — so a round trip bought
  // nothing but a reload.
  const invoices = await listContractorInvoices(user.companyId);
  const tabCounts = await payTabCounts(user);

  const statusOf = (i: (typeof invoices)[number]) => i.pay?.status ?? "submitted";

  const owed = invoices
    .filter((i) => i.pay && (i.pay.status === "pending" || i.pay.status === "approved"))
    .reduce((s, i) => s + (i.pay?.amount ?? 0), 0);
  const paid = invoices
    .filter((i) => i.pay?.status === "paid")
    .reduce((s, i) => s + (i.pay?.amount ?? 0), 0);
  const ungenerated = invoices.filter((i) => !i.pay).length;
  const approvable = invoices.filter((i) => i.pay?.status === "pending" && i.pay.amount > 0).length;
  const unpriced = invoices.filter((i) => i.pay?.status === "pending" && i.pay.amount === 0).length;

  const count = (s: string) => invoices.filter((i) => statusOf(i) === s).length;
  const facets: ListFacet[] = STATUS_ORDER.filter((s) => count(s) > 0).map((s) => ({
    key: s,
    label: s,
    count: count(s),
  }));

  // Everything the row does not print but somebody will type: the full address,
  // the project number, the role of whoever sent it.
  const searchText = (i: (typeof invoices)[number]) =>
    [statusOf(i), i.job.address, i.job.projectNumber, i.uploadedBy?.name, i.name]
      .filter(Boolean)
      .join(" ");

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractor Pay"
        description="Invoices submitted by the crews who did the work. Price them from the PDF, approve, and they go into the next payroll run."
        action={
          <>
            {/* The payout report is the same money asked about by period rather
                than by invoice — a report, so it reads as one and does not take
                a tab of its own. */}
            {can(user, "read", "Commission") && (
              <Button asChild variant="outline" size="sm">
                <Link href="/portal/contractor-pay/payouts">
                  <BarChart3 className="size-4" /> Payout report
                </Link>
              </Button>
            )}
            {canManage && <ContractorPayToolbar ungenerated={ungenerated} approvable={approvable} />}
          </>
        }
      />

      <PayTabs user={user} active="/portal/contractor-pay" counts={tabCounts} />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard
          label="Owed"
          value={fmt.money(owed, { compact: true })}
          hint={ungenerated > 0 ? `${ungenerated} not yet priced` : "approved + pending"}
          icon={Clock3}
          accent
        />
        <StatCard label="Paid" value={fmt.money(paid, { compact: true })} hint="all time" icon={DollarSign} />
        <StatCard
          label="Invoices"
          value={invoices.length}
          hint={`${count("submitted")} awaiting Generate`}
          icon={ReceiptText}
        />
      </div>

      {/* Said out loud rather than left to be noticed: an unpriced line is
          invisible to Approve All and to payroll, so a stack of them is a stack
          of contractors quietly not being paid. */}
      {unpriced > 0 && canManage && (
        <p className="rounded-lg border border-dashed border-amber-500/40 bg-amber-500/5 px-4 py-2.5 text-sm text-amber-700 dark:text-amber-300">
          {unpriced === 1 ? "1 invoice still needs" : `${unpriced} invoices still need`} an amount
          typed in before {unpriced === 1 ? "it" : "they"} can be approved.
        </p>
      )}

      {invoices.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title="No invoices submitted yet"
          description="An invoice appears here the moment a contractor drops it into the Contractor Invoice folder on a job."
        />
      ) : (
        <ListFilter placeholder="Job, address, project # or who sent it…" facets={facets}>
          {/* Desktop: table. Mobile: cards (below). */}
          <div
            data-search-hide-when-empty
            className="hidden overflow-hidden rounded-xl border border-border bg-card md:block"
          >
            <Table className="[&_td]:px-4 [&_th]:px-4">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className={TH}>Job</TableHead>
                  <TableHead className={TH}>Contractor</TableHead>
                  {/* The slack column — see the Commissions table. */}
                  <TableHead className={`${TH} w-full`}>Invoice</TableHead>
                  <TableHead className={`${TH} text-right`}>Amount</TableHead>
                  <TableHead className={TH}>Status</TableHead>
                  {canManage && <TableHead className={`${TH} text-right`}>Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow
                    key={inv.id}
                    className="align-top"
                    data-search-item
                    data-search-facet={statusOf(inv)}
                    data-search-text={searchText(inv)}
                  >
                    <TableCell className="py-3 font-medium">
                      {/* The job links out; the invoice does not live there, but
                          whoever is about to pay it wants the job in front of
                          them. Accounting reads deals company-wide, so this
                          never lands on a 404. */}
                      {inv.job.leadId ? (
                        <Link href={`/portal/leads/${inv.job.leadId}`} className="hover:text-gold-muted hover:underline">
                          {inv.job.customer}
                        </Link>
                      ) : (
                        inv.job.customer
                      )}
                      <span className="block text-xs font-normal text-muted-foreground">
                        {[inv.job.projectNumber, inv.job.address].filter(Boolean).join(" · ") || "—"}
                      </span>
                    </TableCell>
                    <TableCell className="py-3">
                      {inv.uploadedBy ? (
                        <span className="flex items-center gap-2">
                          <Initials name={inv.uploadedBy.name} />
                          <span>
                            {inv.uploadedBy.name}
                            <span className="block text-xs text-muted-foreground">
                              {roleLabel(inv.uploadedBy.role)}
                            </span>
                          </span>
                        </span>
                      ) : (
                        // uploadedBy is SetNull, so a departed contractor leaves
                        // his invoices standing without a name rather than
                        // taking them with him. Nobody to pay, so no pay line.
                        <span className="text-muted-foreground">Account removed</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <a
                        href={`/portal/files/${inv.id}`}
                        target="_blank"
                        rel="noreferrer"
                        className="flex min-w-0 items-center gap-2 hover:text-gold-muted"
                      >
                        {inv.isPdf ? (
                          <FileText className="size-4 shrink-0 text-muted-foreground" />
                        ) : (
                          <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                        )}
                        <span className="max-w-[16rem] truncate">{inv.name}</span>
                      </a>
                      <span className="block text-xs text-muted-foreground">
                        {dateTime.format(inv.submittedAt)}
                      </span>
                    </TableCell>
                    <TableCell className="py-3 text-right font-medium tabular-nums">
                      {inv.pay ? (
                        <ContractorPayAmount
                          id={inv.pay.id}
                          amount={inv.pay.amount}
                          display={fmt.money(inv.pay.amount)}
                          locked={!canManage || inv.pay.batched || inv.pay.status === "paid"}
                        />
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <PayStatus status={statusOf(inv)} />
                    </TableCell>
                    {canManage && (
                      <TableCell className="py-3 text-right">
                        <ContractorPayRowActions
                          payId={inv.pay?.id ?? null}
                          status={inv.pay?.status ?? null}
                          amount={inv.pay?.amount ?? 0}
                          batched={inv.pay?.batched ?? false}
                        />
                      </TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div data-search-hide-when-empty className="space-y-2 md:hidden">
            {invoices.map((inv) => (
              <div
                key={inv.id}
                data-search-item
                data-search-facet={statusOf(inv)}
                data-search-text={searchText(inv)}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    {inv.job.leadId ? (
                      <Link href={`/portal/leads/${inv.job.leadId}`} className="font-medium hover:text-gold-muted">
                        {inv.job.customer}
                      </Link>
                    ) : (
                      <span className="font-medium">{inv.job.customer}</span>
                    )}
                    <div className="text-xs text-muted-foreground">
                      {[inv.job.projectNumber, inv.job.address].filter(Boolean).join(" · ") || "—"}
                    </div>
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Initials name={inv.uploadedBy?.name ?? "?"} className="size-5 text-[9px]" />
                      {inv.uploadedBy?.name ?? "Account removed"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-medium tabular-nums">
                    {inv.pay ? (
                      <ContractorPayAmount
                        id={inv.pay.id}
                        amount={inv.pay.amount}
                        display={fmt.money(inv.pay.amount)}
                        locked={!canManage || inv.pay.batched || inv.pay.status === "paid"}
                      />
                    ) : (
                      <span className="text-muted-foreground">—</span>
                    )}
                  </div>
                </div>
                <a
                  href={`/portal/files/${inv.id}`}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-2 text-sm hover:text-gold-muted"
                >
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="truncate">{inv.name}</span>
                </a>
                <div className="flex items-center justify-between gap-2">
                  <PayStatus status={statusOf(inv)} />
                  {canManage ? (
                    <ContractorPayRowActions
                      payId={inv.pay?.id ?? null}
                      status={inv.pay?.status ?? null}
                      amount={inv.pay?.amount ?? 0}
                      batched={inv.pay?.batched ?? false}
                    />
                  ) : (
                    <span className="text-xs text-muted-foreground">
                      {dateTime.format(inv.submittedAt)}
                    </span>
                  )}
                </div>
              </div>
            ))}
          </div>

          {/* Hidden inline rather than by class: the filter shows it by CLEARING
              the inline display, which a `hidden` class would then override. */}
          <p
            data-search-empty
            style={{ display: "none" }}
            className="rounded-xl border border-dashed border-border bg-card/50 px-6 py-10 text-center text-sm text-muted-foreground"
          >
            No invoices match that search. Try the customer’s last name, the street, the project
            number, or whoever uploaded it.
          </p>
        </ListFilter>
      )}
    </div>
  );
}
