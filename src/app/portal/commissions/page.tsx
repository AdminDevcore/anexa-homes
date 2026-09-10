import Link from "next/link";
import { redirect } from "next/navigation";
import { Clock3, DollarSign, Wallet } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { commissionGateLabel } from "@/server/modules/payroll/eligibility";
import { payTabCounts } from "@/server/modules/payroll/pay-tab-counts";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { PayTabs } from "@/components/portal/pay-tabs";
import { PayStatus } from "@/components/portal/pay-status";
import { Initials } from "@/components/portal/initials";
import { CommissionRowActions, CommissionsToolbar } from "@/components/portal/commission-actions";
import { RaiseChargeback, ChargebackDecision } from "@/components/portal/chargeback-actions";
import { CompReviewQueue } from "@/components/portal/comp-review-queue";
import { dealsNeedingCompReview } from "@/server/modules/solar/deal-comp";
import { ListFilter, type ListFacet } from "@/components/portal/list-filter";
import { currentFormatters } from "@/lib/format-server";
import { addressSearchText } from "@/lib/address";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const metadata = { title: "Commissions" };

/** The order money moves in, which is the order the chips are drawn in. */
const STATUS_ORDER = ["pending", "approved", "paid", "void"];

export default async function CommissionsPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();
  if (!can(user, "read", "Commission")) redirect("/portal/dashboard");

  const canManage = can(user, "approve", "Commission");
  const scope = listScope(user, "Commission") as Prisma.CommissionWhereInput;
  // Isolate to the active vertical workspace (a deal's vertical lives on its lead).
  const vertical = await getActiveVertical(user);
  const commissions = await prisma.commission.findMany({
    where: { AND: [scope, { project: { lead: { vertical } } }] },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { firstName: true, lastName: true } },
      project: {
        select: {
          id: true,
          projectNumber: true,
          address: true,
          city: true,
          state: true,
          zip: true,
          lead: {
            select: {
              firstName: true,
              lastName: true,
              address: true,
              city: true,
              state: true,
              zip: true,
            },
          },
        },
      },
    },
  });

  // A commission row shows a project number and a name — never the job site. The
  // address rides along in data-search-text so "Oak" or "75024" still finds it.
  const searchText = (c: (typeof commissions)[number]) =>
    `${c.status} ${addressSearchText(c.project)} ${addressSearchText(c.project.lead)}`;

  /* THE TWO REVIEW QUEUES THIS PAGE OWNS.
   *
   * Both are admin-only and both are read straight through, not through
   * listScope: a rep must not see either. `dealsNeedingCompReview` is the
   * migration queue for signed deals payroll is refusing; `pendingChargebacks`
   * is the second-pair-of-eyes list, because raising a chargeback and approving
   * one are deliberately different acts. */
  const [compReview, pendingChargebacks] = canManage
    ? await Promise.all([
        dealsNeedingCompReview(user.companyId),
        prisma.chargeback.findMany({
          where: { companyId: user.companyId, status: "pending" },
          orderBy: { createdAt: "asc" },
          include: {
            user: { select: { firstName: true, lastName: true } },
            commission: { select: { label: true, project: { select: { projectNumber: true } } } },
          },
        }),
      ])
    : [[], []];

  // Every line already charged back, so a second one is not raised by accident
  // against the same commission.
  const chargedBack = new Set(
    (
      await prisma.chargeback.findMany({
        where: { companyId: user.companyId, status: { in: ["pending", "approved", "settled"] } },
        select: { commissionId: true },
      })
    )
      .map((c) => c.commissionId)
      .filter((x): x is string => !!x)
  );

  const tabCounts = await payTabCounts(user);

  const sum = (status: string) =>
    commissions.filter((c) => c.status === status).reduce((s, c) => s + c.amount, 0);
  const count = (status: string) => commissions.filter((c) => c.status === status).length;

  const pendingCount = count("pending");
  const lines = (n: number) => (n === 1 ? "1 line" : `${n} lines`);

  // Only statuses that actually occur get a chip — an empty "Void" filter is a
  // dead end, and the counts are the point of the row.
  const facets: ListFacet[] = STATUS_ORDER.filter((s) => count(s) > 0).map((s) => ({
    key: s,
    label: s,
    count: count(s),
  }));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        description={`What the sales floor has earned. Generate runs only on deals that have reached ${commissionGateLabel(vertical)}.`}
        action={canManage ? <CommissionsToolbar pendingCount={pendingCount} /> : undefined}
      />

      <PayTabs user={user} active="/portal/commissions" counts={tabCounts} />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard
          label="Awaiting approval"
          value={fmt.money(sum("pending"), { compact: true })}
          hint={lines(pendingCount)}
          icon={Clock3}
          accent
        />
        <StatCard
          label="Approved to pay"
          value={fmt.money(sum("approved"), { compact: true })}
          hint={lines(count("approved"))}
          icon={Wallet}
        />
        <StatCard
          label="Paid"
          value={fmt.money(sum("paid"), { compact: true })}
          hint={lines(count("paid"))}
          icon={DollarSign}
        />
      </div>

      {canManage && (
        <CompReviewQueue
          rows={compReview.map((r) => ({
            leadId: r.leadId,
            customerName: `${r.lead?.firstName ?? ""} ${r.lead?.lastName ?? ""}`.trim() || "Unnamed deal",
            address: r.lead?.address ?? null,
            repName: r.rep ? `${r.rep.firstName} ${r.rep.lastName}`.trim() : "Unassigned",
            signedAt: r.signedAt?.toISOString() ?? null,
          }))}
        />
      )}

      {canManage && pendingChargebacks.length > 0 && (
        <div className="space-y-3 rounded-xl border border-border bg-card p-5">
          <h3 className="font-semibold">Chargebacks awaiting approval</h3>
          <p className="text-[11px] text-muted-foreground">
            Nothing is recoverable until one of these is approved. Approving does not take money —
            it opens a balance that an admin draws down on a payroll run, in whatever amount they
            choose.
          </p>
          <ul className="divide-y divide-border">
            {pendingChargebacks.map((cb) => (
              <li key={cb.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 text-sm">
                <div className="min-w-0">
                  <div className="font-medium">
                    {`${cb.user.firstName} ${cb.user.lastName} — ${fmt.money(cb.amountCents)}`}
                  </div>
                  <div className="text-[11px] text-muted-foreground">
                    {cb.reason.replace(/_/g, " ")}
                    {cb.commission?.project?.projectNumber ? ` · ${cb.commission.project.projectNumber}` : ""}
                    {cb.notes ? ` · ${cb.notes}` : ""}
                  </div>
                </div>
                <ChargebackDecision chargebackId={cb.id} />
              </li>
            ))}
          </ul>
        </div>
      )}

      {commissions.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No commissions yet"
          description={
            canManage
              ? "Click “Generate” to compute commissions from active rules. Deals that have not reached the funding gate are skipped."
              : "Nothing has been earned on a funded deal yet."
          }
        />
      ) : (
        <ListFilter placeholder="Search project, address, recipient…" facets={facets}>
          {/* Desktop: table. Mobile: cards (below). */}
          <div
            data-search-hide-when-empty
            className="hidden overflow-hidden rounded-xl border border-border bg-card md:block"
          >
            <Table className="[&_td]:px-4 [&_th]:px-4">
              <TableHeader>
                <TableRow className="bg-muted/40 hover:bg-muted/40">
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Project</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Recipient</TableHead>
                  {/* The slack column: it absorbs the width the others do not need, so
                      Status and Actions sit beside the money instead of drifting
                      to the far edge of a wide screen. */}
                  <TableHead className="hidden w-full text-xs font-medium uppercase tracking-wide text-muted-foreground lg:table-cell">Label</TableHead>
                  <TableHead className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Amount</TableHead>
                  <TableHead className="text-xs font-medium uppercase tracking-wide text-muted-foreground">Status</TableHead>
                  {canManage ? (
                    <TableHead className="text-right text-xs font-medium uppercase tracking-wide text-muted-foreground">Actions</TableHead>
                  ) : (
                    <TableHead className="hidden text-xs font-medium uppercase tracking-wide text-muted-foreground sm:table-cell">Date</TableHead>
                  )}
                </TableRow>
              </TableHeader>
              <TableBody>
                {commissions.map((c) => (
                  <TableRow
                    key={c.id}
                    data-search-item
                    data-search-facet={c.status}
                    data-search-text={searchText(c)}
                  >
                    <TableCell className="py-3 font-medium">
                      <Link href={`/portal/projects/${c.projectId}`} className="hover:text-gold-muted hover:underline">
                        {c.project.projectNumber}
                      </Link>
                      {c.project.lead && (
                        <span className="block text-xs font-normal text-muted-foreground">
                          {`${c.project.lead.firstName} ${c.project.lead.lastName}`}
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="py-3">
                      <span className="flex items-center gap-2">
                        <Initials name={`${c.user.firstName} ${c.user.lastName}`} />
                        {`${c.user.firstName} ${c.user.lastName}`}
                      </span>
                    </TableCell>
                    <TableCell className="hidden py-3 text-sm text-muted-foreground lg:table-cell">{c.label ?? "—"}</TableCell>
                    <TableCell className="py-3 text-right font-medium tabular-nums">{fmt.money(c.amount)}</TableCell>
                    <TableCell className="py-3">
                      <PayStatus status={c.status} />
                    </TableCell>
                    {canManage ? (
                      <TableCell className="py-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          <CommissionRowActions id={c.id} status={c.status} />
                          {/* Only money that has actually been earned can be
                              clawed back. A pending line is simply voided, and a
                              line already charged back does not offer it twice. */}
                          {(c.status === "approved" || c.status === "paid") && !chargedBack.has(c.id) && (
                            <RaiseChargeback
                              commissionId={c.id}
                              userId={c.userId}
                              recipientName={`${c.user.firstName} ${c.user.lastName}`.trim()}
                              amountCents={c.amount}
                              isOverride={!!c.overrideId}
                            />
                          )}
                        </div>
                      </TableCell>
                    ) : (
                      <TableCell className="hidden py-3 text-sm text-muted-foreground sm:table-cell">{fmt.date(c.createdAt)}</TableCell>
                    )}
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {/* Mobile: cards */}
          <div data-search-hide-when-empty className="space-y-2 md:hidden">
            {commissions.map((c) => (
              <div
                key={c.id}
                data-search-item
                data-search-facet={c.status}
                data-search-text={searchText(c)}
                className="flex flex-col gap-2 rounded-xl border border-border bg-card p-3.5"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`/portal/projects/${c.projectId}`} className="font-medium hover:text-gold-muted">
                      {c.project.projectNumber}
                    </Link>
                    {c.project.lead ? (
                      <div className="text-xs text-muted-foreground">
                        {`${c.project.lead.firstName} ${c.project.lead.lastName}`}
                      </div>
                    ) : null}
                    <div className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                      <Initials name={`${c.user.firstName} ${c.user.lastName}`} className="size-5 text-[9px]" />
                      {`${c.user.firstName} ${c.user.lastName}`}
                    </div>
                  </div>
                  <div className="shrink-0 text-right font-medium tabular-nums">{fmt.money(c.amount)}</div>
                </div>
                <div className="flex items-center justify-between gap-2">
                  <PayStatus status={c.status} />
                  {canManage ? (
                    <CommissionRowActions id={c.id} status={c.status} />
                  ) : (
                    <span className="text-xs text-muted-foreground">{fmt.date(c.createdAt)}</span>
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
            No commissions match that search.
          </p>
        </ListFilter>
      )}
    </div>
  );
}
