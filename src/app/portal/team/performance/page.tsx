import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Users, Target, Hammer, TrendingUp } from "lucide-react";
import { requireUser } from "@/server/auth/session";
import { PageHeader, StatCard } from "@/components/portal/ui";
import { TeamPerformanceControls } from "@/components/portal/team-performance-controls";
import { canSeeTeamOps } from "@/server/modules/dashboard/ops";
import { getTeamPerformance } from "@/server/modules/dashboard/team-performance";
import { resolvePeriod } from "@/server/modules/reports/period";
import { getActiveVertical } from "@/server/auth/vertical";
import { VERTICAL_LABEL } from "@/lib/vertical";
import { currentFormatters } from "@/lib/format-server";

export const metadata = { title: "Team Performance" };

/**
 * The team leaderboard over a date range a manager chooses.
 *
 * It lives under /portal/team rather than in Reports because the people who run
 * a sales floor have no Report grant — /portal/reports redirects them straight
 * back to the dashboard. Same reason the summary card exists on the dashboard
 * at all; this is that card with the window opened up.
 */
export default async function TeamPerformancePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const user = await requireUser();
  if (!canSeeTeamOps(user)) redirect("/portal/dashboard");

  const fmt = await currentFormatters();
  const sp = await searchParams;
  const str = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? "";

  const period = resolvePeriod(str(sp.period) || "month", str(sp.from), str(sp.to));
  const vertical = await getActiveVertical(user);
  const data = await getTeamPerformance(user, vertical, period);

  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);
  const money = (cents: number | null) => (cents == null ? "—" : fmt.money(cents, { compact: true }));
  const dateOnly = (d: Date) => d.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const range = `${dateOnly(period.from)} – ${dateOnly(period.to)}`;
  // A custom range's label IS the range, so printing both says it twice.
  const described =
    period.preset === "all"
      ? "All time · everything on the books"
      : period.preset === "custom"
        ? range
        : `${period.label} · ${range}`;

  return (
    <div className="space-y-6">
      <Link
        href="/portal/dashboard"
        className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Dashboard
      </Link>

      <PageHeader
        title="Team Performance"
        description={`${described} · ${VERTICAL_LABEL[vertical]} workspace`}
        action={
          <Link href="/portal/team" className="text-sm text-gold-muted hover:underline">
            Team roster
          </Link>
        }
      />

      <TeamPerformanceControls preset={period.preset} from={str(sp.from)} to={str(sp.to)} />

      <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <StatCard
          label="Appointments"
          value={data.totals.appointments}
          icon={Users}
          hint={
            data.unassigned.appointments > 0
              ? `+${data.unassigned.appointments} with no rep assigned`
              : "booked in this period"
          }
        />
        <StatCard
          label="Won"
          value={data.totals.won}
          icon={Target}
          hint={`${pct(data.totals.closeRatePct)} close rate`}
        />
        <StatCard
          label="Installs"
          value={data.totals.installs}
          icon={Hammer}
          hint={
            data.unassigned.installs > 0
              ? `+${data.unassigned.installs} with no rep assigned`
              : "install date in this period"
          }
        />
        {data.canSeeFinancials && (
          <StatCard label="Sold" value={money(data.totals.soldCents)} icon={TrendingUp} accent hint="contract value written" />
        )}
      </div>

      <div className="rounded-xl border border-border bg-card">
        <div className="border-b border-border px-5 py-4">
          <h2 className="font-semibold">By rep</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Appointments and wins count deals CREATED in this period, so the close rate is one
            cohort. Installs count jobs whose install date falls in it.
          </p>
        </div>

        {data.rows.length === 0 ? (
          <p className="px-5 py-10 text-center text-sm text-muted-foreground">
            Nobody on the roster carried a deal in this period.
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
                  <th className="px-3 py-2.5 text-right font-medium">Installs</th>
                  {data.canSeeFinancials && <th className="px-5 py-2.5 text-right font-medium">Sold</th>}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {data.rows.map((row) => (
                  <tr key={row.userId} className={row.appointments === 0 && row.installs === 0 ? "text-muted-foreground" : undefined}>
                    <td className="px-5 py-3">
                      <Link href={`/portal/team/${row.userId}`} className="font-medium hover:text-gold-muted">
                        {row.name}
                      </Link>
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.appointments}</td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.won}</td>
                    <td className="px-3 py-3 text-right tabular-nums">
                      {row.appointments > 0 ? pct(row.closeRatePct) : "—"}
                    </td>
                    <td className="px-3 py-3 text-right tabular-nums">{row.installs}</td>
                    {data.canSeeFinancials && (
                      <td className="px-5 py-3 text-right tabular-nums">{money(row.soldCents)}</td>
                    )}
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr className="border-t border-border font-medium">
                  <td className="px-5 py-3">Team total</td>
                  <td className="px-3 py-3 text-right tabular-nums">{data.totals.appointments}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{data.totals.won}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{pct(data.totals.closeRatePct)}</td>
                  <td className="px-3 py-3 text-right tabular-nums">{data.totals.installs}</td>
                  {data.canSeeFinancials && (
                    <td className="px-5 py-3 text-right tabular-nums">{money(data.totals.soldCents)}</td>
                  )}
                </tr>
              </tfoot>
            </table>
          </div>
        )}

        {/* Where the Won column comes from. A leaderboard nobody can trace is a
            leaderboard nobody trusts. */}
        <p className="border-t border-border px-5 py-3 text-xs text-muted-foreground">
          Won counts deals at or past{" "}
          <Link href="/portal/settings/pipeline" className="underline underline-offset-2">
            {data.saleLineLabel ?? "the stage marked as sold"}
          </Link>{" "}
          — change which stage that is in Settings → Pipeline Stages.
        </p>
      </div>
    </div>
  );
}
