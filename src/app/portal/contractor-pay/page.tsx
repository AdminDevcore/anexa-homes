import { redirect } from "next/navigation";
import Link from "next/link";
import { FileText, ImageIcon, ReceiptText, Search } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { PageHeader, EmptyState } from "@/components/portal/ui";
import { Button } from "@/components/ui/button";
import { roleLabel } from "@/lib/roles";
import { listContractorInvoices } from "@/server/modules/contractor-pay/queries";
import { ContractorPayTabs } from "@/components/portal/contractor-pay-tabs";

export const metadata = { title: "Contractor Pay" };

const dateTime = new Intl.DateTimeFormat("en-US", {
  month: "short",
  day: "numeric",
  year: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

function fileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/**
 * Contractor Pay → Invoices.
 *
 * The ONLY place a contractor's invoice can be opened. The job it was dropped
 * on shows it was submitted and nothing more, on purpose — see
 * src/lib/contractor-invoice.ts for why a deal is the wrong permission for a
 * cost-of-goods document.
 *
 * Gated twice, which is not redundant: this page lists file ids, and a file id
 * is a URL. The route that serves the bytes carries the same check, so a
 * guessed or copied link is refused even though it never appeared in a list.
 */
export default async function ContractorPayPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!can(user, "read", "ContractorInvoice")) redirect("/portal/dashboard");

  const sp = await searchParams;
  const q = (Array.isArray(sp.q) ? sp.q[0] : sp.q) ?? "";
  const invoices = await listContractorInvoices(user.companyId, q);

  return (
    <div className="space-y-6">
      <PageHeader
        title="Contractor Pay"
        description="Invoices submitted by the crews who did the work, and what they are owed."
      />

      <ContractorPayTabs active="invoices" showPayouts={can(user, "read", "Commission")} />

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
        <div className="overflow-x-auto rounded-xl border border-border bg-card">
          <table className="w-full min-w-[46rem] text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3 font-medium">Job</th>
                <th className="px-4 py-3 font-medium">Submitted by</th>
                <th className="px-4 py-3 font-medium">Submitted</th>
                <th className="px-4 py-3 font-medium">Invoice</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {invoices.map((inv) => (
                <tr key={inv.id} className="align-top">
                  <td className="px-4 py-3">
                    {/* The job links out; the invoice does not live there, but
                        whoever is about to pay it wants the job in front of
                        them. Accounting reads deals company-wide, so this
                        never lands on a 404. */}
                    {inv.job.leadId ? (
                      <Link href={`/portal/leads/${inv.job.leadId}`} className="font-medium hover:text-gold-muted">
                        {inv.job.customer}
                      </Link>
                    ) : (
                      <span className="font-medium">{inv.job.customer}</span>
                    )}
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      {[inv.job.projectNumber, inv.job.address].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    {inv.uploadedBy ? (
                      <>
                        <div className="font-medium">{inv.uploadedBy.name}</div>
                        <div className="mt-0.5 text-xs text-muted-foreground">
                          {roleLabel(inv.uploadedBy.role)}
                        </div>
                      </>
                    ) : (
                      // The uploader relation is SetNull, so a departed
                      // contractor leaves his invoices standing without a name
                      // rather than taking them with him.
                      <span className="text-muted-foreground">Account removed</span>
                    )}
                  </td>
                  <td className="whitespace-nowrap px-4 py-3 tabular-nums text-muted-foreground">
                    {dateTime.format(inv.submittedAt)}
                  </td>
                  <td className="px-4 py-3">
                    <a
                      href={`/portal/files/${inv.id}`}
                      target="_blank"
                      rel="noreferrer"
                      className="flex min-w-0 items-center gap-2 font-medium hover:text-gold-muted"
                    >
                      {inv.isPdf ? (
                        <FileText className="size-4 shrink-0 text-muted-foreground" />
                      ) : (
                        <ImageIcon className="size-4 shrink-0 text-muted-foreground" />
                      )}
                      <span className="truncate">{inv.name}</span>
                    </a>
                    <div className="mt-0.5 text-xs text-muted-foreground">{fileSize(inv.sizeBytes)}</div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
