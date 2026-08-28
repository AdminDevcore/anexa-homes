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
  Coins,
  Timer,
  Target,
  AlarmClock,
  Hourglass,
} from "lucide-react";
import { requireUser } from "@/server/auth/session";
import {
  getDashboardStats,
  getRecentLeads,
  getRecentProjects,
} from "@/server/modules/dashboard/queries";
import { canSeeTeamOps, getOverrideEarnings, getTeamOps } from "@/server/modules/dashboard/ops";
import { PageHeader, StatCard } from "@/components/portal/ui";
import { currentFormatters } from "@/lib/format-server";
import { roleLabel } from "@/lib/roles";
import { getActiveVertical, userVerticals } from "@/server/auth/vertical";
import { VERTICAL_LABEL, allowedVerticals } from "@/lib/vertical";
import { DashboardEmptyHint } from "@/components/portal/dashboard-empty-hint";
import { stageChipStyle } from "@/lib/chip-color";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const fmt = await currentFormatters();
  const user = await requireUser();

  const vertical = await getActiveVertical(user);
  // Managers have no Report grant, so /portal/reports bounces them back here —
  // their team + operations numbers have to live on this page or nowhere.
  const seesTeamOps = canSeeTeamOps(user);
  const [stats, leads, projects, overrides, ops] = await Promise.all([
    getDashboardStats(user, vertical),
    getRecentLeads(user, vertical),
    getRecentProjects(user, vertical),
    getOverrideEarnings(user),
    seesTeamOps ? getTeamOps(user, vertical) : Promise.resolve(null),
  ]);

  const days = (n: number | null) => (n == null ? "—" : `${n} ${n === 1 ? "day" : "days"}`);
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);

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
        {/* What this person earns off other people's deals. Absent entirely for
            anyone who doesn't earn overrides, rather than showing them a $0. */}
        {overrides && (
          <StatCard
            label="Total Overrides"
            value={fmt.money(overrides.earnedCents, { compact: true })}
            icon={Coins}
            hint={`${fmt.money(overrides.pendingCents, { compact: true })} pending`}
          />
        )}
      </div>

      {ops && (
        <section className="space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Team &amp; operations
          </h2>

          <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <StatCard
              label="Avg Turnaround"
              value={days(ops.days)}
              icon={Timer}
              hint={
                ops.sample > 0
                  ? `lead → install complete · ${ops.sample} job${ops.sample === 1 ? "" : "s"}`
                  : "lead → install complete"
              }
            />
            <StatCard
              label="Close Rate"
              value={pct(ops.closeRatePct)}
              icon={Target}
              hint={`${ops.wonLeads} won of ${stats.totalLeads}`}
            />
            <StatCard
              label="Overdue Jobs"
              value={ops.overdueJobs}
              icon={AlarmClock}
              hint="past their stage day-limit"
            />
            <StatCard
              label="Avg Days in Stage"
              value={days(ops.avgDaysInStage)}
              icon={Hourglass}
              hint={`${ops.openDeals} open deal${ops.openDeals === 1 ? "" : "s"}`}
            />
          </div>

          <div className="rounded-xl border border-border bg-card">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <h3 className="font-semibold">Team Performance</h3>
              <Link href="/portal/team" className="text-sm text-gold-muted hover:underline">
                View team
              </Link>
            </div>
            {ops.team.length === 0 ? (
              <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                No deals assigned to a rep yet.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="px-5 py-2.5 text-left font-medium">Rep</th>
                      <th className="px-3 py-2.5 text-right font-medium">Appts</th>
                      <th className="px-3 py-2.5 text-right font-medium">Won</th>
                      <th className="px-3 py-2.5 text-right font-medium">Close</th>
                      {ops.canSeeFinancials && (
                        <th className="px-5 py-2.5 text-right font-medium">Sold</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {ops.team.map((row) => (
                      <tr key={row.userId}>
                        <td className="px-5 py-3">
                          <Link href={`/portal/team/${row.userId}`} className="font-medium hover:text-gold-muted">
                            {row.name}
                          </Link>
                        </td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.appointments}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{row.won}</td>
                        <td className="px-3 py-3 text-right tabular-nums">{pct(row.closeRatePct)}</td>
                        {ops.canSeeFinancials && (
                          <td className="px-5 py-3 text-right tabular-nums">
                            {row.soldCents == null ? "—" : fmt.money(row.soldCents, { compact: true })}
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </section>
      )}

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
                      className="rounded-full border px-2.5 py-1 text-[11px] font-medium"
                      style={stageChipStyle(l.stage.color)}
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
                {/* The deal's pipeline stage, not `Project.status` — that
                    second status duplicated this one and lost its control on
                    the deal page, so it now sits at whatever it was last set
                    to. The stage moves every day. */}
                <span className="rounded-full bg-muted px-2.5 py-1 text-[11px] font-medium">
                  {p.lead.stage?.name ?? "No stage"}
                </span>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}
