"use client";

import * as React from "react";
import Link from "next/link";
import { ChevronRight, Users2 } from "lucide-react";
import { useFormat } from "@/components/portal/branding-provider";
import type { TeamGroup } from "@/server/modules/dashboard/team-performance";

/**
 * The leaderboard by TEAM rather than by person.
 *
 * A sales floor is run in teams — Team Alpha against Team Kings — and the
 * per-rep table can't answer "which team is winning" without a manager adding
 * up rows by hand. Every team row is the sum of exactly the members listed
 * under it, so opening a team is how you check the total, not a separate query
 * that might disagree with it.
 */
export function TeamPerformanceTeams({
  teams,
  canSeeFinancials,
}: {
  teams: TeamGroup[];
  canSeeFinancials: boolean;
}) {
  const fmt = useFormat();
  // Nothing is open to start: the point of this view is the comparison between
  // teams, and five expanded rosters bury it.
  const [open, setOpen] = React.useState<Record<string, boolean>>({});
  const pct = (n: number | null) => (n == null ? "—" : `${Math.round(n)}%`);
  const money = (cents: number | null) => (cents == null ? "—" : fmt.money(cents, { compact: true }));

  const total = (pick: (t: TeamGroup) => number) => teams.reduce((n, t) => n + pick(t), 0);
  const appts = total((t) => t.appointments);
  const won = total((t) => t.won);

  if (teams.length === 0) {
    return (
      <p className="px-5 py-10 text-center text-sm text-muted-foreground">
        No team carried a deal in this period.
      </p>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border text-xs uppercase tracking-wide text-muted-foreground">
            <th className="px-5 py-2.5 text-left font-medium">Team</th>
            <th className="px-3 py-2.5 text-right font-medium">Appts</th>
            <th className="px-3 py-2.5 text-right font-medium">Won</th>
            <th className="px-3 py-2.5 text-right font-medium">Close</th>
            <th className="px-3 py-2.5 text-right font-medium">Installs</th>
            {canSeeFinancials && <th className="px-5 py-2.5 text-right font-medium">Sold</th>}
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {teams.map((team) => {
            const key = team.managerId ?? "__none__";
            const expanded = !!open[key];
            return (
              <React.Fragment key={key}>
                <tr className={team.managerId == null ? "text-muted-foreground" : undefined}>
                  <td className="px-5 py-3">
                    <button
                      type="button"
                      onClick={() => setOpen((o) => ({ ...o, [key]: !o[key] }))}
                      aria-expanded={expanded}
                      className="flex items-center gap-1.5 text-left font-medium hover:text-gold-muted"
                    >
                      <ChevronRight className={`size-3.5 shrink-0 transition-transform ${expanded ? "rotate-90" : ""}`} />
                      <Users2 className="size-3.5 shrink-0 text-muted-foreground" />
                      {team.name}
                      <span className="text-xs font-normal text-muted-foreground">
                        {`· ${team.members.length} ${team.members.length === 1 ? "person" : "people"}`}
                      </span>
                    </button>
                    {/* The manager's name only when it isn't already the team's
                        name — otherwise every unnamed team says it twice. */}
                    {team.named && team.managerName && (
                      <span className="ml-[26px] block text-xs text-muted-foreground">{team.managerName}</span>
                    )}
                    {team.managerId == null && (
                      <span className="ml-[26px] block text-xs">Nobody on this list reports to a sales manager.</span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{team.appointments}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{team.won}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{pct(team.closeRatePct)}</td>
                  <td className="px-3 py-3 text-right font-medium tabular-nums">{team.installs}</td>
                  {canSeeFinancials && (
                    <td className="px-5 py-3 text-right font-medium tabular-nums">{money(team.soldCents)}</td>
                  )}
                </tr>
                {expanded &&
                  team.members.map((row) => (
                    <tr key={row.userId} className="bg-muted/30 text-muted-foreground">
                      <td className="py-2 pl-[52px] pr-5">
                        <Link href={`/portal/team/${row.userId}`} className="hover:text-gold-muted">
                          {row.name}
                        </Link>
                        {row.userId === team.managerId && <span className="ml-2 text-[11px]">manager</span>}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.appointments}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.won}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {row.appointments > 0 ? pct(row.closeRatePct) : "—"}
                      </td>
                      <td className="px-3 py-2 text-right tabular-nums">{row.installs}</td>
                      {canSeeFinancials && (
                        <td className="px-5 py-2 text-right tabular-nums">{money(row.soldCents)}</td>
                      )}
                    </tr>
                  ))}
              </React.Fragment>
            );
          })}
        </tbody>
        <tfoot>
          <tr className="border-t border-border font-medium">
            <td className="px-5 py-3">All teams</td>
            <td className="px-3 py-3 text-right tabular-nums">{appts}</td>
            <td className="px-3 py-3 text-right tabular-nums">{won}</td>
            <td className="px-3 py-3 text-right tabular-nums">{pct(appts > 0 ? (won / appts) * 100 : null)}</td>
            <td className="px-3 py-3 text-right tabular-nums">{total((t) => t.installs)}</td>
            {canSeeFinancials && (
              <td className="px-5 py-3 text-right tabular-nums">{money(total((t) => t.soldCents ?? 0))}</td>
            )}
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
