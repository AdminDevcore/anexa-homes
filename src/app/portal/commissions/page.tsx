import Link from "next/link";
import { redirect } from "next/navigation";
import { DollarSign } from "lucide-react";
import type { Prisma } from "@prisma/client";
import { requireUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { prisma } from "@/server/db/client";
import { listScope } from "@/server/rbac/policies";
import { getActiveIndustry } from "@/server/auth/industry";
import { PageHeader, EmptyState, StatCard } from "@/components/portal/ui";
import { CommissionRowActions, CommissionsToolbar } from "@/components/portal/commission-actions";
import { ListFilter } from "@/components/portal/list-filter";
import { currentFormatters } from "@/lib/format-server";
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
  // Isolate to the active industry workspace (a deal's industry lives on its lead).
  const industry = await getActiveIndustry(user);
  const commissions = await prisma.commission.findMany({
    where: { AND: [scope, { project: { lead: { industry } } }] },
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { firstName: true, lastName: true } },
      project: { select: { id: true, projectNumber: true, lead: { select: { firstName: true, lastName: true } } } },
    },
  });

  const totalPending = commissions
    .filter((c) => c.status === "pending" || c.status === "approved")
    .reduce((s, c) => s + c.amount, 0);
  const totalPaid = commissions.filter((c) => c.status === "paid").reduce((s, c) => s + c.amount, 0);
  const pendingCount = commissions.filter((c) => c.status === "pending").length;

  return (
    <div className="space-y-6">
      <PageHeader
        title="Commissions"
        description="Track earned, approved, and paid commissions. Generate runs only on deals that have reached Depreciation Requested."
        action={canManage ? <CommissionsToolbar pendingCount={pendingCount} /> : undefined}
      />

      <div className="grid grid-cols-3 gap-2.5 sm:gap-4">
        <StatCard label="Pending + Approved" value={fmt.money(totalPending, { compact: true })} icon={DollarSign} accent />
        <StatCard label="Paid" value={fmt.money(totalPaid, { compact: true })} icon={DollarSign} />
        <StatCard label="Records" value={commissions.length} icon={DollarSign} />
      </div>

      {commissions.length === 0 ? (
        <EmptyState
          icon={DollarSign}
          title="No commissions yet"
          description={canManage ? "Click “Generate” to compute commissions from active rules." : undefined}
        />
      ) : (
        <ListFilter placeholder="Search project, recipient, status…">
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
                <TableRow key={c.id} data-search-item data-search-text={`${c.project.projectNumber} ${c.project.lead ? `${c.project.lead.firstName} ${c.project.lead.lastName}` : ""} ${c.user.firstName} ${c.user.lastName} ${c.label ?? ""} ${c.status}`}>
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
                      <CommissionRowActions id={c.id} status={c.status} />
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
              data-search-text={`${c.project.projectNumber} ${c.project.lead ? `${c.project.lead.firstName} ${c.project.lead.lastName}` : ""} ${c.user.firstName} ${c.user.lastName} ${c.label ?? ""} ${c.status}`}
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
