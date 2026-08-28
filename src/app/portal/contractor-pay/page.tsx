import { redirect } from "next/navigation";
import Link from "next/link";
import { DollarSign, FileText, ImageIcon, ReceiptText, Search } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roles";
import { currentFormatters } from "@/lib/format-server";
import { listContractorInvoices } from "@/server/modules/contractor-pay/queries";
import { ContractorPayTabs } from "@/components/portal/contractor-pay-tabs";
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

/**
 * Contractor Pay — the crews' Commissions tab.
 *
 * Deliberately the same shape as `/portal/commissions`: totals across the top,
 * Generate and Approve All in the header, one row per payable, and the same
 * pending → approved → paid vocabulary, because it feeds the same payroll run.
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
export default async function ContractorPayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "ContractorInvoice")) redirect("/portal/dashboard");

  const canManage = can(user, "update", "ContractorInvoice");
  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const invoices = await listContractorInvoices(user.companyId, q);

  const owed = invoices
    .filter((i) => i.pay && (i.pay.status === "pending" || i.pay.status === "approved"))
    .reduce((s, i) => s + (i.pay?.amount ?? 0), 0);
  const paid = invoices
    .filter((i) => i.pay?.status === "paid")
    .reduce((s, i) => s + (i.pay?.amount ?? 0), 0);
  const ungenerated = invoices.filter((i) => !i.pay).length;
  const approvable = invoices.filter((i) => i.pay?.status === "pending" && i.pay.amount > 0).length;
  const unpriced = invoices.filter((i) => i.pay?.status === "pending" && i.pay.amount === 0).length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractor Pay"
        description="Invoices submitted by the crews who did the work. Price them from the PDF, approve, and they go into the next payroll run."
        action={
          canManage ? (
            <ContractorPayToolbar ungenerated={ungenerated} approvable={approvable} />
          ) : undefined
        }
      />

      <ContractorPayTabs active="invoices" showPayouts={can(user, "read", "Commission")} />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard label="Owed" value={fmt.money(owed, { compact: true })} icon={DollarSign} accent />
        <StatCard label="Paid" value={fmt.money(paid, { compact: true })} icon={DollarSign} />
        <StatCard label="Invoices" value={invoices.length} icon={ReceiptText} />
      </div>

      {/* Said out loud rather than left to be noticed: an unpriced line is
          invisible to Approve All and to payroll, so a stack of them is a stack
          of contractors quietly not being paid. */}
      {unpriced > 0 && canManage && (
        <p className="rounded-lg border border-dashed border-border bg-muted/30 px-4 py-2.5 text-sm text-muted-foreground">
          {unpriced === 1 ? "1 invoice still needs" : `${unpriced} invoices still need`} an amount
          typed in before {unpriced === 1 ? "it" : "they"} can be approved.
        </p>
      )}

      <form method="get" className="flex max-w-md items-center gap-2">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            name="q"
            defaultValue={q}
            placeholder="Job, address, project # or who submitted it"
            aria-label="Search submitted invoices"
            className="h-9 w-full rounded-md border border-border bg-background pl-8 pr-3 text-sm"
          />
        </div>
        <Button type="submit" size="sm" variant="outline">
          Search
        </Button>
      </form>

      {invoices.length === 0 ? (
        <EmptyState
          icon={ReceiptText}
          title={q ? "No invoices match that search" : "No invoices submitted yet"}
          description={
            q
              ? "Try the customer's last name, the street, the project number, or the name of whoever uploaded it."
              : "An invoice appears here the moment a contractor drops it into the Contractor Invoice folder on a job."
          }
        />
      ) : (
        <>
          {/* Desktop: table. Mobile: cards (below). */}
          <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Job</TableHead>
                  <TableHead>Contractor</TableHead>
                  <TableHead>Invoice</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  {canManage && <TableHead className="text-right">Actions</TableHead>}
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map((inv) => (
                  <TableRow key={inv.id} className="align-top">
                    <TableCell className="font-medium">
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
                    <TableCell>
                      {inv.uploadedBy ? (
                        <>
                          {inv.uploadedBy.name}
                          <span className="block text-xs text-muted-foreground">
                            {roleLabel(inv.uploadedBy.role)}
                          </span>
                        </>
                      ) : (
                        // uploadedBy is SetNull, so a departed contractor leaves
                        // his invoices standing without a name rather than
                        // taking them with him. Nobody to pay, so no pay line.
                        <span className="text-muted-foreground">Account removed</span>
                      )}
                    </TableCell>
                    <TableCell>
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
                    <TableCell className="text-right font-medium">
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
                    <TableCell>
                      <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">
                        {inv.pay?.status ?? "submitted"}
                      </span>
                    </TableCell>
                    {canManage && (
                      <TableCell className="text-right">
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
          <div className="space-y-2 md:hidden">
            {invoices.map((inv) => (
              <div key={inv.id} className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5">
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
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      → {inv.uploadedBy?.name ?? "Account removed"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-medium">
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
                  <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">
                    {inv.pay?.status ?? "submitted"}
                  </span>
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
        </>
      )}
    </div>
  );
}
