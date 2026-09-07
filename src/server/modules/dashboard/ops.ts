import type { Prisma, Role, Vertical } from "@prisma/client";
import { prisma } from "@/server/db/client";
import type { SessionUser } from "@/server/auth/session";
import { can } from "@/server/rbac/guards";
import { daysInStage, stageTiming } from "@/lib/stage-status";
import { getSaleLine } from "@/server/modules/pipeline/sale-line";
import { dashboardLeadWhere, dashboardProjectWhere } from "./scope";
import { canSeeFinancials } from "./queries";

/**
 * The team + operations numbers a sales manager runs on.
 *
 * These exist on the DASHBOARD, not in Reports, for a boring reason: the role
 * matrix gives `manager` no `Report` grant, so /portal/reports redirects them
 * straight back here. Every figure below is one a manager would otherwise have
 * to ask an admin to pull.
 */

const DAY = 86_400_000;

/**
 * How far back the turnaround average looks. A job finished two years ago says
 * nothing about how the current crew is running, and left unbounded the average
 * only ever gets stickier as the company ages.
 */
export const TURNAROUND_WINDOW_DAYS = 365;

/** Roles that manage other people — the audience for team-wide ops numbers. */
const LEADERSHIP_ROLES: Role[] = ["super_admin", "admin", "manager"];

export function canSeeTeamOps(user: Pick<SessionUser, "role">): boolean {
  return LEADERSHIP_ROLES.includes(user.role);
}

// ── Override earnings ───────────────────────────────────────────────────────

export type OverrideEarnings = {
  /** Every non-void override line this person is the beneficiary of. */
  earnedCents: number;
  /** The part not paid out yet (pending + approved). */
  pendingCents: number;
};

/**
 * What this person earns off OTHER people's deals — the commission lines
 * carrying an `overrideId` (payroll writes them with `userId = beneficiaryId`).
 * Returns null when they neither have an override configured nor have ever been
 * paid one, so the card simply doesn't appear for people who don't earn them.
 *
 * Deliberately NOT filtered by the active workspace, matching the Pending
 * Commissions card beside it and the override sheet on the team page: a
 * person's pay is one number across the business, and `Commission` is the
 * shared-but-segmented model that is never read per-vertical.
 */
export async function getOverrideEarnings(user: SessionUser): Promise<OverrideEarnings | null> {
  if (!can(user, "read", "Commission")) return null;

  const [configured, byStatus] = await Promise.all([
    prisma.commissionOverride.count({
      where: { companyId: user.companyId, beneficiaryId: user.userId },
    }),
    prisma.commission.groupBy({
      by: ["status"],
      where: {
        companyId: user.companyId,
        userId: user.userId,
        overrideId: { not: null },
        status: { not: "void" },
      },
      _sum: { amount: true },
    }),
  ]);

  let earnedCents = 0;
  let pendingCents = 0;
  for (const row of byStatus) {
    const amount = row._sum.amount ?? 0;
    earnedCents += amount;
    if (row.status === "pending" || row.status === "approved") pendingCents += amount;
  }

  if (configured === 0 && earnedCents === 0) return null;
  return { earnedCents, pendingCents };
}

// ── Turnaround: lead created → install complete ─────────────────────────────

export type TurnaroundJob = {
  leadCreatedAt: Date;
  completedAt: Date | null;
  installDate: Date | null;
};

/**
 * The date a job actually finished.
 *
 * `Project.completedAt` is typed in by hand on the admin-only job edit form, so
 * most finished jobs never get one. The scheduled install date is the next-best
 * truth. A job with neither is DROPPED rather than guessed at — inventing a
 * completion date silently drags the average toward whatever we invented.
 */
export function completionDate(job: Pick<TurnaroundJob, "completedAt" | "installDate">): Date | null {
  return job.completedAt ?? job.installDate ?? null;
}

export type Turnaround = {
  /** Whole days, lead created → install complete. Null when nothing qualified. */
  days: number | null;
  /** How many jobs the average is built from — a thin sample should look thin. */
  sample: number;
};

export function averageTurnaroundDays(jobs: TurnaroundJob[]): Turnaround {
  let total = 0;
  let n = 0;
  for (const job of jobs) {
    const done = completionDate(job);
    if (!done) continue;
    const ms = done.getTime() - job.leadCreatedAt.getTime();
    // A completion date typed in before the lead existed is bad data, not a
    // zero-day job; counting it would pull the average down for free.
    if (ms < 0) continue;
    total += ms;
    n += 1;
  }
  return n > 0 ? { days: Math.round(total / n / DAY), sample: n } : { days: null, sample: 0 };
}

// ── Open-pipeline health ────────────────────────────────────────────────────

export type OpenLead = {
  createdAt: Date;
  stageChangedAt: Date | null;
  stage: { targetDays: number } | null;
};

export type PipelineHealth = {
  openDeals: number;
  /** Deals past their stage's day-limit. Same math as the Overdue Jobs report. */
  overdueJobs: number;
  /** Average age of an open deal in its current stage. Null when none are open. */
  avgDaysInStage: number | null;
};

export function pipelineHealth(leads: OpenLead[], now: number = Date.now()): PipelineHealth {
  let ageTotal = 0;
  let overdue = 0;
  for (const lead of leads) {
    ageTotal += daysInStage(lead.stageChangedAt, lead.createdAt, now);
    // Only internally-owned stages carry a targetDays > 0; an externally-blocked
    // stage (permit review, utility interconnection) is never "overdue" — see
    // the note in lib/stage-status.ts.
    if (!lead.stage || lead.stage.targetDays <= 0) continue;
    const timing = stageTiming(lead.stageChangedAt, lead.createdAt, lead.stage.targetDays, now);
    if (timing.status === "overdue") overdue += 1;
  }
  return {
    openDeals: leads.length,
    overdueJobs: overdue,
    avgDaysInStage: leads.length > 0 ? Math.round(ageTotal / leads.length) : null,
  };
}

// ── Team leaderboard ────────────────────────────────────────────────────────

export type TeamRow = {
  userId: string;
  name: string;
  appointments: number;
  won: number;
  closeRatePct: number;
  /** Deals with an install date on the books. */
  installs: number;
  /** Null when the viewer isn't allowed to see money. */
  soldCents: number | null;
};

/**
 * Won is decided by the deal's STAGE, not by `Lead.status` — see
 * lib/sold-stage.ts. The caller resolves it because the rule is one query
 * against the pipelines, not one per tally.
 */
export type LeadTally = { assignedRepId: string | null; won: boolean; count: number };
export type ProjectTally = { assignedRepId: string | null; contractValue: number };
/** One row per installed / scheduled job, already filtered by the caller. */
export type InstallTally = { assignedRepId: string | null };

export type TeamSummary = {
  totalLeads: number;
  wonLeads: number;
  /** Won ÷ appointments, company-wide within scope. Null when there are none. */
  closeRatePct: number | null;
  totalInstalls: number;
  rows: TeamRow[];
};

/**
 * Roll the per-rep tallies into leaderboard rows plus the scope-wide close rate.
 *
 * Deals with no assigned rep still count toward the scope-wide totals — they are
 * real appointments — but they get no row: "Unassigned" is not a performer, and
 * a leaderboard it can top is a leaderboard nobody reads.
 *
 * `include` seeds rows for people who must appear whatever they did, so a rep
 * who booked nothing this month shows a line of zeroes rather than vanishing
 * from the report a manager is using to find exactly that.
 */
export function summariseTeam(input: {
  leads: LeadTally[];
  projects: ProjectTally[];
  installs: InstallTally[];
  nameOf: (userId: string) => string;
  seeMoney: boolean;
  include?: { userId: string; name: string }[];
}): TeamSummary {
  const { leads, projects, installs, nameOf, seeMoney, include } = input;
  let totalLeads = 0;
  let wonLeads = 0;
  let totalInstalls = 0;
  const byRep = new Map<string, { appointments: number; won: number; installs: number; soldCents: number }>();
  const entry = (id: string) => {
    const existing = byRep.get(id);
    if (existing) return existing;
    const fresh = { appointments: 0, won: 0, installs: 0, soldCents: 0 };
    byRep.set(id, fresh);
    return fresh;
  };

  for (const person of include ?? []) entry(person.userId);

  for (const lead of leads) {
    totalLeads += lead.count;
    if (lead.won) wonLeads += lead.count;
    if (!lead.assignedRepId) continue;
    const rep = entry(lead.assignedRepId);
    rep.appointments += lead.count;
    if (lead.won) rep.won += lead.count;
  }

  for (const project of projects) {
    if (!project.assignedRepId) continue;
    entry(project.assignedRepId).soldCents += project.contractValue;
  }

  for (const job of installs) {
    totalInstalls += 1;
    if (!job.assignedRepId) continue;
    entry(job.assignedRepId).installs += 1;
  }

  const named = new Map((include ?? []).map((p) => [p.userId, p.name]));
  const rows: TeamRow[] = [...byRep.entries()]
    .map(([userId, agg]) => ({
      userId,
      name: named.get(userId) ?? nameOf(userId),
      appointments: agg.appointments,
      won: agg.won,
      closeRatePct: agg.appointments > 0 ? (agg.won / agg.appointments) * 100 : 0,
      installs: agg.installs,
      soldCents: seeMoney ? agg.soldCents : null,
    }))
    // Won first — that is the job. Volume breaks the tie.
    .sort((a, b) => b.won - a.won || b.appointments - a.appointments || a.name.localeCompare(b.name));

  return {
    totalLeads,
    wonLeads,
    closeRatePct: totalLeads > 0 ? (wonLeads / totalLeads) * 100 : null,
    totalInstalls,
    rows,
  };
}

// ── The fetch ───────────────────────────────────────────────────────────────

export type TeamOps = PipelineHealth &
  Turnaround & {
    closeRatePct: number | null;
    wonLeads: number;
    totalInstalls: number;
    team: TeamRow[];
    canSeeFinancials: boolean;
    /** The stage a deal counts as sold from, for the "what does Won mean" line. */
    saleLineLabel: string | null;
  };

export async function getTeamOps(user: SessionUser, vertical: Vertical): Promise<TeamOps> {
  // Same two filters the rest of the dashboard runs on: who this viewer may see,
  // AND the active workspace. A manager's numbers are their team's numbers.
  const leadWhere = dashboardLeadWhere(user, vertical);
  const projectWhere = dashboardProjectWhere(user, vertical);
  const now = Date.now();
  const since = new Date(now - TURNAROUND_WINDOW_DAYS * DAY);
  const seeMoney = canSeeFinancials(user);

  const finishedInWindow: Prisma.ProjectWhereInput = {
    OR: [
      { completedAt: { gte: since } },
      // Jobs nobody typed a completion date on fall back to the install date —
      // see `completionDate`.
      { AND: [{ completedAt: null }, { installDate: { gte: since } }] },
    ],
  };

  const [completedJobs, openLeads, leadTallies, projectRows, installRows, saleLine] = await Promise.all([
    prisma.project.findMany({
      where: { AND: [projectWhere, { status: { in: ["completed", "closed"] } }, finishedInWindow] },
      select: { completedAt: true, installDate: true, lead: { select: { createdAt: true } } },
    }),
    prisma.lead.findMany({
      where: { AND: [leadWhere, { status: "open" }] },
      select: { createdAt: true, stageChangedAt: true, stage: { select: { targetDays: true } } },
    }),
    // Grouped by STAGE, not status: which stages mean "sold" is a setting, and
    // `Lead.status` is never written to `won` by anything in the app.
    prisma.lead.groupBy({
      by: ["assignedRepId", "stageId"],
      where: leadWhere,
      _count: { _all: true },
    }),
    seeMoney
      ? prisma.project.findMany({
          where: { AND: [projectWhere, { status: { not: "cancelled" } }] },
          select: { contractValue: true, lead: { select: { assignedRepId: true } } },
        })
      : Promise.resolve([] as { contractValue: number; lead: { assignedRepId: string | null } }[]),
    // An install is a job with a date on the calendar — scheduled counts, which
    // is the whole point of tracking it here. A cancelled job does not: its date
    // is a booking nobody kept.
    prisma.project.findMany({
      where: { AND: [projectWhere, { status: { not: "cancelled" } }, { installDate: { not: null } }] },
      select: { lead: { select: { assignedRepId: true } } },
    }),
    getSaleLine(user.companyId, vertical),
  ]);

  const repIds = [...new Set(leadTallies.map((t) => t.assignedRepId).filter((id): id is string => !!id))];
  const users = repIds.length
    ? await prisma.user.findMany({
        where: { id: { in: repIds } },
        select: { id: true, firstName: true, lastName: true },
      })
    : [];
  const nameById = new Map(users.map((u) => [u.id, `${u.firstName} ${u.lastName}`.trim() || "Unnamed"]));

  const turnaround = averageTurnaroundDays(
    completedJobs.map((p) => ({
      leadCreatedAt: p.lead.createdAt,
      completedAt: p.completedAt,
      installDate: p.installDate,
    })),
  );
  const health = pipelineHealth(openLeads, now);
  const team = summariseTeam({
    leads: leadTallies.map((t) => ({
      assignedRepId: t.assignedRepId,
      won: t.stageId != null && saleLine.stageIds.has(t.stageId),
      count: t._count._all,
    })),
    projects: projectRows.map((p) => ({ assignedRepId: p.lead.assignedRepId, contractValue: p.contractValue })),
    installs: installRows.map((p) => ({ assignedRepId: p.lead.assignedRepId })),
    nameOf: (id) => nameById.get(id) ?? "Unnamed",
    seeMoney,
  });

  return {
    ...health,
    ...turnaround,
    closeRatePct: team.closeRatePct,
    wonLeads: team.wonLeads,
    totalInstalls: team.totalInstalls,
    team: team.rows,
    canSeeFinancials: seeMoney,
    saleLineLabel: saleLine.label,
  };
}
