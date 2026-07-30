import Link from "next/link";
import {
  Users,
  FolderKanban,
  Hammer,
  FileSignature,
  Wallet,
  DollarSign,
  CheckCircle2,
  TrendingUp,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import {
  getDashboardStats,
  getRecentLeads,
  getRecentProjects,
} from "@/server/modules/dashboard/queries";
import { PageHeader, StatCard } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { roleLabel } from "@/lib/roles";
import { getActiveVertical, userVerticals } from "@/server/auth/vertical";
import { VERTICAL_LABEL, allowedVerticals } from "@/lib/vertical";
import { DashboardEmptyHint } from "@/components/portal/dashboard-empty-hint";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();

  const vertical = await getActiveVertical(user);
  const [stats, leads, projects] = await Promise.all([
    getDashboardStats(user, vertical),
    getRecentLeads(user, vertical),
    getRecentProjects(user, vertical),
  ]);

  // If the active workspace is empty but the user has others, guide them to switch
  // (so an empty workspace isn't mistaken for "I can't see the company's deals").
  const dealFlowEmpty =
    stats.totalLeads === 0 && stats.activeProjects === 0 && stats.jobsInProduction === 0 && stats.completedJobs === 0;
  const otherWorkspaces = userVerticals(user)
    .filter((i) => i !== vertical)
    .map((i) => ({ ind: i, label: VERTICAL_LABEL[i] }));

  return (
    <div className="space-y-6">
      <PageHeader
        title={`Welcome back, ${user.firstName}`}
        description={`${roleLabel(user.role)} · ${VERTICAL_LABEL[vertical]} workspace`}
      />

      {dealFlowEmpty && otherWorkspaces.length > 0 ? (
        <DashboardEmptyHint activeLabel={VERTICAL_LABEL[vertical]} others={otherWorkspaces} />
      ) : null}

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard label="Total Appointments" value={stats.totalLeads} icon={Users} />
        <StatCard label="Active Projects" value={stats.activeProjects} icon={FolderKanban} />
        <StatCard label="In Production" value={stats.jobsInProduction} icon={Hammer} />
        <StatCard label="Pending Signatures" value={stats.pendingSignatures} icon={FileSignature} />
        <StatCard label="Completed Jobs" value={stats.completedJobs} icon={CheckCircle2} />
        {stats.canSeeFinancials && (
          <StatCard
            label="Revenue (Closed)"
            value={fmt.money(stats.revenueCents, { compact: true })}
            icon={TrendingUp}
            accent
          />
        )}
        {stats.canSeeCommissions && (
          <StatCard
            label="Pending Commissions"
            value={fmt.money(stats.pendingCommissionsCents, { compact: true })}
            icon={DollarSign}
          />
        )}
        {stats.canSeePayroll && (
          <StatCard
            label="Pending Payroll"
            value={fmt.money(stats.pendingPayrollCents, { compact: true })}
            icon={Wallet}
          />
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Recent leads */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Recent Appointments</h2>
            <Link href="/portal/leads" className="text-sm text-gold-muted hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {leads.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">No appointments yet.</li>
            )}
            {leads.map((l) => (
              <li key={l.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <Link href={`/portal/leads/${l.id}`} className="font-medium hover:text-gold-muted">
                    {l.firstName} {l.lastName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {l.source?.name ?? "—"} · {fmt.date(l.createdAt)}
                  </div>
                </div>
                <div className="flex items-center gap-3">
                  {l.value != null && (
                    <span className="text-sm font-medium">{fmt.money(l.value, { compact: true })}</span>
                  )}
                  {l.stage && (
                    <span
                      className="rounded-full px-2.5 py-1 text-[11px] font-medium"
                      style={{ backgroundColor: `${l.stage.color}22`, color: l.stage.color }}
                    >
                      {l.stage.name}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        </div>

        {/* Recent projects */}
        <div className="rounded-xl border border-border bg-card">
          <div className="flex items-center justify-between border-b border-border px-5 py-4">
            <h2 className="font-semibold">Active Projects</h2>
            <Link href="/portal/projects" className="text-sm text-gold-muted hover:underline">
              View all
            </Link>
          </div>
          <ul className="divide-y divide-border">
            {projects.length === 0 && (
              <li className="px-5 py-8 text-center text-sm text-muted-foreground">No projects yet.</li>
            )}
            {projects.map((p) => (
              <li key={p.id} className="flex items-center justify-between px-5 py-3.5">
                <div>
                  <Link href={`/portal/projects/${p.id}`} className="font-medium hover:text-gold-muted">
                    {p.projectNumber} · {p.lead.firstName} {p.lead.lastName}
                  </Link>
                  <div className="text-xs text-muted-foreground">
                    {p.manager ? `PM: ${p.manager.firstName} ${p.manager.lastName}` : "Unassigned"}
                  </div>
                </div>
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium capitalize">
                  {p.status.replace(/_/g, " ")}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
