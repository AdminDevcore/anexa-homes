import Link from "next/link";
import { redirect } from "next/navigation";
import { DollarSign } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveVertical } from "@/server/auth/vertical";
import { commissionGateLabel } from "@/server/modules/payroll/eligibility";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { CommissionRowActions, CommissionsToolbar } from "@/components/portal/commission-actions";
import { RaiseChargeback, ChargebackDecision } from "@/components/portal/chargeback-actions";
import { CompReviewQueue } from "@/components/portal/comp-review-queue";
import { dealsNeedingCompReview } from "@/server/modules/solar/deal-comp";
import { ListFilter } from "@/components/portal/list-filter";
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

  const totalPending = commissions
    .filter((c) => c.status === "pending" || c.status === "approved")
    .reduce((s, c) => s + c.amount, 0);
  const totalPaid = commissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.amount, 0);
  const pendingCount = commissions.filter((c) => c.status === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        description={`Track earned, approved, and paid commissions. Generate runs only on deals that have reached ${commissionGateLabel(vertical)}.`}
        action={canManage ? <CommissionsToolbar pendingCount={pendingCount} /> : undefined}
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard label="Pending + Approved" value={fmt.money(totalPending, { compact: true })} icon={DollarSign} accent />
        <StatCard label="Paid" value={fmt.money(totalPaid, { compact: true })} icon={DollarSign} />
        <StatCard label="Records" value={commissions.length} icon={DollarSign} />
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
                    {cb.user.firstName} {cb.user.lastName} — {fmt.money(cb.amountCents)}
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
          description={canManage ? "Click “Generate” to compute commissions from active rules." : undefined}
        />
      ) : (
        <ListFilter placeholder="Search project, address, recipient…">
        {/* Desktop: table. Mobile: cards (below). */}
        <div className="hidden overflow-hidden rounded-xl border border-border bg-card md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Project</TableHead>
                <TableHead>Recipient</TableHead>
                <TableHead className="hidden md:table-cell">Label</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
                {canManage && <TableHead className="text-right">Actions</TableHead>}
                {!canManage && <TableHead className="hidden sm:table-cell">Date</TableHead>}
              </TableRow>
            </TableHeader>
            <TableBody>
              {commissions.map((c) => (
                <TableRow key={c.id} data-search-item data-search-text={searchText(c)}>
                  <TableCell className="font-medium">
                    <Link href={`/portal/projects/${c.projectId}`} className="hover:text-gold-muted hover:underline">
                      {c.project.projectNumber}
                    </Link>
                    {c.project.lead && (
                      <span className="block text-xs font-normal text-muted-foreground">
                        {c.project.lead.firstName} {c.project.lead.lastName}
                      </span>
                    )}
                  </TableCell>
                  <TableCell>{c.user.firstName} {c.user.lastName}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm text-muted-foreground">{c.label ?? "—"}</TableCell>
                  <TableCell className="text-right font-medium">{fmt.money(c.amount)}</TableCell>
                  <TableCell>
                    <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">{c.status}</span>
                  </TableCell>
                  {canManage ? (
                    <TableCell className="text-right">
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
                    <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">{fmt.date(c.createdAt)}</TableCell>
                  )}
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        {/* Mobile: cards */}
        <div className="space-y-2 md:hidden">
          {commissions.map((c) => (
            <div
              key={c.id}
              data-search-item
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
                      {c.project.lead.firstName} {c.project.lead.lastName}
                    </div>
                  ) : null}
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    → {c.user.firstName} {c.user.lastName}
                  </div>
                </div>
                <div className="shrink-0 text-right font-medium">{fmt.money(c.amount)}</div>
              </div>
              <div className="flex items-center justify-between gap-2">
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">{c.status}</span>
                {canManage ? (
                  <CommissionRowActions id={c.id} status={c.status} />
                ) : (
                  <span className="text-xs text-muted-foreground">{fmt.date(c.createdAt)}</span>
                )}
              </div>
            </div>
          ))}
        </div>
        </ListFilter>
      )}
    </div>
  );
}
