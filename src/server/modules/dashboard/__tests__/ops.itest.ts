import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { runInVertical } from "@/server/vertical/context";
import { getOverrideEarnings, getTeamOps } from "../ops";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * The manager dashboard's team + operations numbers against a real database.
 *
 * Unit tests already pin the arithmetic; what needs a database is everything
 * around it — that a manager's figures cover THEIR TEAM and nobody else's, that
 * the workspace filter survives alongside the ownership filter, and that
 * override pay is read across workspaces while deal flow is not. Those are all
 * `where`-clause claims, and a type can't hold them.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const DAY = 86_400_000;
const daysAgo = (n: number) => new Date(Date.now() - n * DAY);

let companyId: string;
let managerId: string;
let myRepId: string;
let otherRepId: string;
let stageId: string;

function session(userId: string, role: string): SessionUser {
  return { userId, companyId, role, permissions: {} } as unknown as SessionUser;
}

/** One deal + optional job, wired to a rep and a workspace. */
async function deal(opts: {
  repId: string | null;
  vertical: "roofing" | "solar";
  status?: "open" | "won" | "lost";
  createdAt?: Date;
  stage?: boolean;
  stageChangedAt?: Date;
  job?: { contractValue: number; status: "completed" | "not_started"; completedAt?: Date; installDate?: Date };
}) {
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: opts.vertical,
      firstName: "T",
      lastName: "Case",
      assignedRepId: opts.repId,
      status: opts.status ?? "open",
      createdAt: opts.createdAt ?? daysAgo(60),
      ...(opts.stage ? { stageId, stageChangedAt: opts.stageChangedAt ?? daysAgo(3) } : {}),
    },
  });
  if (opts.job) {
    await db.project.create({
      data: {
        companyId,
        vertical: opts.vertical,
        leadId: lead.id,
        projectNumber: `J-${lead.id.slice(0, 8)}`,
        status: opts.job.status,
        contractValue: opts.job.contractValue,
        completedAt: opts.job.completedAt ?? null,
        installDate: opts.job.installDate ?? null,
      },
    });
  }
  return lead;
}

beforeAll(async () => {
  // No schema-wide truncate: this suite owns one uniquely-slugged company and
  // every figure it asserts is company-scoped, so leftovers from a sibling
  // suite can't reach it. Fixtures are built on the UNEXTENDED client because
  // they are deliberately cross-vertical — a roofing deal and a solar deal for
  // the same rep is the setup for the workspace-filter case below.
  const company = await db.company.create({
    data: { name: "Ops Dashboard Co", slug: `ops-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const mk = (email: string, role: string, extra: Record<string, unknown> = {}) =>
    db.user.create({
      data: {
        companyId,
        email: `${email}-${process.pid}@test.local`,
        passwordHash: "x",
        firstName: email,
        lastName: "User",
        role: role as never,
        verticals: ["roofing", "solar"],
        ...extra,
      },
    });

  managerId = (await mk("mgr", "manager")).id;
  myRepId = (await mk("mine", "sales_rep", { managerId })).id;
  // Reports to nobody — deliberately outside the manager's team.
  otherRepId = (await mk("theirs", "sales_rep")).id;

  const pipeline = await db.pipeline.create({ data: { companyId, name: "P", vertical: "roofing" } });
  // targetDays 7: a deal sitting longer than a week in this stage is overdue.
  stageId = (await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "s0", name: "Inspection", position: 0, targetDays: 7 },
  })).id;

  // ---- The manager's team, roofing ----
  // Two won deals, one of which finished 30 days after the lead came in.
  await deal({
    repId: myRepId,
    vertical: "roofing",
    status: "won",
    createdAt: daysAgo(60),
    job: { contractValue: 500_000, status: "completed", completedAt: daysAgo(30) },
  });
  // No completedAt typed in — the install date has to carry it (20 days).
  await deal({
    repId: myRepId,
    vertical: "roofing",
    status: "won",
    createdAt: daysAgo(40),
    job: { contractValue: 300_000, status: "completed", installDate: daysAgo(20) },
  });
  // Two open deals: one overdue in stage (20d > 7d), one fresh (2d).
  await deal({ repId: myRepId, vertical: "roofing", stage: true, stageChangedAt: daysAgo(20) });
  await deal({ repId: myRepId, vertical: "roofing", stage: true, stageChangedAt: daysAgo(2) });

  // ---- Same company, but must NOT reach the manager's numbers ----
  await deal({
    repId: otherRepId,
    vertical: "roofing",
    status: "won",
    createdAt: daysAgo(365),
    job: { contractValue: 9_999_900, status: "completed", completedAt: daysAgo(1) },
  });
  await deal({ repId: otherRepId, vertical: "roofing", stage: true, stageChangedAt: daysAgo(400) });
  // The manager's own rep, but in the other workspace.
  await deal({ repId: myRepId, vertical: "solar", status: "won", createdAt: daysAgo(10) });
});

afterAll(async () => {
  // Every fixture hangs off the company by a cascading relation.
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("getTeamOps", () => {
  it("averages turnaround over the manager's completed jobs only", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    // 30d and 20d — the other rep's 364-day job is out of scope entirely.
    expect(ops.sample).toBe(2);
    expect(ops.days).toBe(25);
  });

  it("counts a job whose only completion signal is the install date", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    // Would be sample 1 if the installDate fallback were dropped.
    expect(ops.sample).toBe(2);
  });

  it("flags deals past their stage day-limit, and only those", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    expect(ops.openDeals).toBe(2);
    expect(ops.overdueJobs).toBe(1);
    expect(ops.avgDaysInStage).toBe(11); // (20 + 2) / 2
  });

  it("closes the rate over the team's own deals", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    // 4 roofing deals for this team, 2 won.
    expect(ops.wonLeads).toBe(2);
    expect(ops.closeRatePct).toBe(50);
  });

  it("builds a leaderboard of the manager's reps and nobody else's", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    expect(ops.team).toHaveLength(1);
    expect(ops.team[0]).toMatchObject({ userId: myRepId, appointments: 4, won: 2, soldCents: 800_000 });
  });

  // The scope regression this whole module inherits: the vertical filter and the
  // ownership filter must BOTH survive. A solar deal by the manager's own rep is
  // out of the Roofing dashboard.
  it("keeps the workspace filter alongside the ownership filter", async () => {
    const roofing = await runInVertical("roofing", () => getTeamOps(session(managerId, "manager"), "roofing"));
    const solar = await runInVertical("solar", () => getTeamOps(session(managerId, "manager"), "solar"));
    expect(roofing.team[0].appointments).toBe(4);
    expect(solar.team[0].appointments).toBe(1);
    expect(solar.sample).toBe(0);
  });

  it("shows an admin the whole company", async () => {
    const ops = await runInVertical("roofing", () => getTeamOps(session(managerId, "super_admin"), "roofing"));
    expect(ops.team).toHaveLength(2);
    expect(ops.sample).toBe(3);
  });
});

describe("getOverrideEarnings", () => {
  it("is absent for someone who earns no overrides", async () => {
    const earnings = await runInVertical("roofing", () => getOverrideEarnings(session(myRepId, "sales_rep")));
    expect(earnings).toBeNull();
  });

  it("sums the manager's override lines and splits out what is still owed", async () => {
    const override = await db.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: myRepId, vertical: "roofing", percent: 5 },
    });
    const project = await db.project.findFirstOrThrow({ where: { companyId } });
    await db.commission.createMany({
      data: [
        { companyId, projectId: project.id, userId: managerId, overrideId: override.id, amount: 10_000, status: "paid" },
        { companyId, projectId: project.id, userId: managerId, overrideId: override.id, amount: 4_000, status: "pending" },
        { companyId, projectId: project.id, userId: managerId, overrideId: override.id, amount: 1_000, status: "approved" },
        // Void money is not money.
        { companyId, projectId: project.id, userId: managerId, overrideId: override.id, amount: 99_999, status: "void" },
        // The manager's own split line on a deal, not an override.
        { companyId, projectId: project.id, userId: managerId, overrideId: null, amount: 77_777, status: "pending" },
      ],
    });

    const earnings = await runInVertical("roofing", () => getOverrideEarnings(session(managerId, "manager")));
    expect(earnings).toEqual({ earnedCents: 15_000, pendingCents: 5_000 });
  });

  // Pay is one number across the business — the same figure a person sees in
  // either workspace, matching the Pending Commissions card beside it.
  it("reads the same in either workspace", async () => {
    const solar = await runInVertical("solar", () => getOverrideEarnings(session(managerId, "manager")));
    expect(solar).toEqual({ earnedCents: 15_000, pendingCents: 5_000 });
  });
});
