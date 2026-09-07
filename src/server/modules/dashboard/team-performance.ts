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

export type TeamPerformance = {
  rows: TeamRow[];
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
      select: { id: true, firstName: true, lastName: true },
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
        select: { id: true, firstName: true, lastName: true },
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

  return {
    rows: summary.rows,
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
