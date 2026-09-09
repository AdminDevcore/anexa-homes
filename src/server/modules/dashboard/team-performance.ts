import type { Prisma, Role, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { getSaleLine } from "@/server/modules/pipeline/sale-line";
import type { Period } from "@/server/modules/reports/period";
import { dashboardLeadWhere, dashboardProjectWhere } from "./scope";
import { canSeeFinancials } from "./queries";
import { summariseTeam, type TeamRow } from "./ops";

/**
 * The team leaderboard over a chosen window — the dashboard card, with a date
 * range on it and everybody on the roster present.
 *
 * WHICH DATE EACH COLUMN IS COUNTED ON is the whole design, and they are
 * deliberately not the same:
 *
 *   APPTS / WON  — the lead's CREATED date. One cohort: of the appointments
 *     booked in this window, how many turned into sales. Counting wins by the
 *     date they closed instead would divide this month's wins by this month's
 *     appointments and produce a close rate off two different sets of deals.
 *
 *   INSTALLS     — the job's INSTALL date. That is what an install date is for,
 *     and it is the number a manager is looking for when they ask how much work
 *     went on roofs in March. Future dates count: a booked install is booked.
 *
 *   SOLD         — the job's CREATED date, which is when the deal was written.
 *     Matches the Rep Scorecard report so the two reconcile.
 *
 * Everyone who could carry a deal appears whether or not they did anything, so
 * a quiet month reads as a row of zeroes rather than a missing person.
 */

/** Roles that carry deals, and so belong on the leaderboard at zero. */
const CLOSING_ROLES: Role[] = ["sales_rep", "manager", "canvasser"];

/**
 * One sales team: a manager, the reps who report to them, the canvassers under
 * those reps — and their numbers added up.
 *
 * The grouping walks exactly the chain the RBAC scope walks (see
 * managerTeamUserFilter in rbac/policies.ts), so a team on this leaderboard
 * contains precisely the people its manager can actually see. Anyone outside
 * every team — an owner running their own deals, a rep nobody has assigned a
 * manager to yet — lands in one honest "No team" row rather than being dropped,
 * because a leaderboard that silently loses deals is worse than one with an
 * awkward row on it.
 */
export type TeamGroup = {
  /** The manager this team hangs off. Null is the no-team bucket. */
  managerId: string | null;
  /** The team's name — "Team Alpha", else "<Manager>'s team", else "No team". */
  name: string;
  managerName: string | null;
  /** Whether the manager has actually named the team, or we fell back. */
  named: boolean;
  members: TeamRow[];
  appointments: number;
  won: number;
  closeRatePct: number | null;
  installs: number;
  soldCents: number | null;
};

export type TeamPerformance = {
  rows: TeamRow[];
  /** The same rows, added up by sales team. Sorted the same way: wins first. */
  teams: TeamGroup[];
  /** The sum of the rows above — a table has to add up. */
  totals: {
    appointments: number;
    won: number;
    closeRatePct: number | null;
    installs: number;
    soldCents: number | null;
  };
  /**
   * Deals in the window carrying no assigned rep. They belong to nobody, so
   * they are outside the table — but they are real appointments, and a total
   * that quietly drops them is how a manager loses count of their own month.
   */
  unassigned: { appointments: number; installs: number };
  canSeeFinancials: boolean;
  /** The stage a deal counts as sold from — what "Won" means on this screen. */
  saleLineLabel: string | null;
};

export async function getTeamPerformance(
  user: SessionUser,
  vertical: Vertical,
  period: Period,
): Promise<TeamPerformance> {
  const leadWhere = dashboardLeadWhere(user, vertical);
  const projectWhere = dashboardProjectWhere(user, vertical);
  const seeMoney = canSeeFinancials(user);
  const inPeriod = { gte: period.from, lte: period.to };
  const live: Prisma.ProjectWhereInput = { status: { not: "cancelled" } };

  const [leadTallies, soldRows, installRows, roster, saleLine] = await Promise.all([
    prisma.lead.groupBy({
      by: ["assignedRepId", "stageId"],
      where: { AND: [leadWhere, { createdAt: inPeriod }] },
      _count: { _all: true },
    }),
    seeMoney
      ? prisma.project.findMany({
          where: { AND: [projectWhere, live, { createdAt: inPeriod }] },
          select: { contractValue: true, lead: { select: { assignedRepId: true } } },
        })
      : Promise.resolve([] as { contractValue: number; lead: { assignedRepId: string | null } }[]),
    prisma.project.findMany({
      where: { AND: [projectWhere, live, { installDate: inPeriod }] },
      select: { lead: { select: { assignedRepId: true } } },
    }),
    prisma.user.findMany({
      where: { companyId: user.companyId, status: "active", role: { in: CLOSING_ROLES } },
      select: { id: true, firstName: true, lastName: true, role: true, managerId: true, salesRep: { select: { managerId: true } } },
    }),
    getSaleLine(user.companyId, vertical),
  ]);

  // Anyone who appears in the numbers but is not on the roster — an owner or an
  // admin running their own deals, or someone since deactivated — still needs a
  // name, so their row does not read "Unnamed".
  const seen = new Set<string>([
    ...leadTallies.map((t) => t.assignedRepId),
    ...soldRows.map((p) => p.lead.assignedRepId),
    ...installRows.map((p) => p.lead.assignedRepId),
  ].filter((id): id is string => !!id));
  for (const person of roster) seen.delete(person.id);

  const extra = seen.size
    ? await prisma.user.findMany({
        where: { id: { in: [...seen] } },
        select: { id: true, firstName: true, lastName: true, role: true, managerId: true, salesRep: { select: { managerId: true } } },
      })
    : [];

  const name = (u: { firstName: string; lastName: string }) => `${u.firstName} ${u.lastName}`.trim() || "Unnamed";
  const nameById = new Map([...roster, ...extra].map((u) => [u.id, name(u)]));

  const summary = summariseTeam({
    leads: leadTallies.map((t) => ({
      assignedRepId: t.assignedRepId,
      won: t.stageId != null && saleLine.stageIds.has(t.stageId),
      count: t._count._all,
    })),
    projects: soldRows.map((p) => ({ assignedRepId: p.lead.assignedRepId, contractValue: p.contractValue })),
    installs: installRows.map((p) => ({ assignedRepId: p.lead.assignedRepId })),
    nameOf: (id) => nameById.get(id) ?? "Unnamed",
    seeMoney,
    // Reps who did nothing in this window are exactly who a manager opened this
    // screen to find.
    include: roster.map((u) => ({ userId: u.id, name: name(u) })),
  });

  const sum = (pick: (r: TeamRow) => number) => summary.rows.reduce((total, r) => total + pick(r), 0);
  const appointments = sum((r) => r.appointments);
  const won = sum((r) => r.won);

  const teams = await groupByTeam(user.companyId, summary.rows, [...roster, ...extra], seeMoney);

  return {
    rows: summary.rows,
    teams,
    totals: {
      appointments,
      won,
      closeRatePct: appointments > 0 ? (won / appointments) * 100 : null,
      installs: sum((r) => r.installs),
      soldCents: seeMoney ? sum((r) => r.soldCents ?? 0) : null,
    },
    unassigned: {
      appointments: summary.totalLeads - appointments,
      installs: summary.totalInstalls - sum((r) => r.installs),
    },
    canSeeFinancials: seeMoney,
    saleLineLabel: saleLine.label,
  };
}

/** Whose team is this person on? Manager → their own; everyone else → up the chain. */
type Placeable = { id: string; role: Role; managerId: string | null; salesRep: { managerId: string | null } | null };

export function teamKeyOf(u: Placeable): string | null {
  if (u.role === "manager") return u.id;
  return u.managerId ?? u.salesRep?.managerId ?? null;
}

/**
 * Fold the per-person rows into per-team rows.
 *
 * The team's totals are the SUM OF ITS MEMBERS' rows, never a second query —
 * so a team can never disagree with the people inside it, which is the first
 * thing a manager checks and the fastest way to lose their trust.
 */
async function groupByTeam(
  companyId: string,
  rows: TeamRow[],
  people: Placeable[],
  seeMoney: boolean,
): Promise<TeamGroup[]> {
  const keyByUser = new Map(people.map((p) => [p.id, teamKeyOf(p)]));
  const buckets = new Map<string | null, TeamRow[]>();
  for (const row of rows) {
    const key = keyByUser.get(row.userId) ?? null;
    const bucket = buckets.get(key);
    if (bucket) bucket.push(row);
    else buckets.set(key, [row]);
  }

  // The managers the buckets are keyed by. Read separately because a team's
  // manager can be outside the leaderboard entirely — suspended, or simply not
  // carrying deals this month — and their team still has to keep its name.
  const managerIds = [...buckets.keys()].filter((k): k is string => k != null);
  const managers = managerIds.length
    ? await prisma.user.findMany({
        where: { id: { in: managerIds }, companyId },
        select: { id: true, firstName: true, lastName: true, teamName: true },
      })
    : [];
  const managerById = new Map(managers.map((m) => [m.id, m]));

  const groups: TeamGroup[] = [...buckets.entries()].map(([managerId, members]) => {
    const manager = managerId ? managerById.get(managerId) : undefined;
    const managerName = manager ? `${manager.firstName} ${manager.lastName}`.trim() : null;
    const total = (pick: (r: TeamRow) => number) => members.reduce((n, r) => n + pick(r), 0);
    const appointments = total((r) => r.appointments);
    const won = total((r) => r.won);
    return {
      managerId,
      name: manager?.teamName || (managerName ? `${managerName}'s team` : "No team"),
      managerName,
      named: !!manager?.teamName,
      // Inside a team, the same order as the rep table: wins first.
      members: [...members].sort((a, b) => b.won - a.won || b.appointments - a.appointments || a.name.localeCompare(b.name)),
      appointments,
      won,
      closeRatePct: appointments > 0 ? (won / appointments) * 100 : null,
      installs: total((r) => r.installs),
      soldCents: seeMoney ? total((r) => r.soldCents ?? 0) : null,
    };
  });

  // Wins first, same as the rep table — and the no-team bucket always last,
  // whatever it scored: it is a gap in the org chart, not a team to beat.
  return groups.sort((a, b) => {
    if ((a.managerId == null) !== (b.managerId == null)) return a.managerId == null ? 1 : -1;
    return b.won - a.won || b.appointments - a.appointments || a.name.localeCompare(b.name);
  });
}
