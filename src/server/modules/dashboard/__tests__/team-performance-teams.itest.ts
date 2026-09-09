import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { SessionUser } from "@/server/auth/session";
import { runInVertical } from "@/server/vertical/context";
import { resolvePeriod } from "@/server/modules/reports/period";
import { getTeamPerformance, teamKeyOf } from "../team-performance";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * The Team Performance leaderboard grouped BY SALES TEAM.
 *
 * The claims worth a database are the org-chart ones: that a team is a manager
 * plus their reps plus the canvassers under those reps (the same chain the RBAC
 * scope walks), that a team's totals are exactly its members' rows added up,
 * and that nobody's deals fall out of the report because they sit under no
 * manager. None of those survive as a unit test — they are all `where` clauses
 * and joins.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let adminId: string;
let alphaMgrId: string;
let unnamedMgrId: string;
let alphaRepId: string;
let alphaCanvasserId: string;
let unnamedRepId: string;
let loneRepId: string;
let soldStageId: string;

const ALL = resolvePeriod("all");

function session(userId: string, role: string): SessionUser {
  return { userId, companyId, role, permissions: {} } as unknown as SessionUser;
}

/** One deal, optionally parked on the sale stage and carrying a job. */
async function deal(repId: string | null, opts: { sold?: boolean; contractValue?: number } = {}) {
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "roofing",
      firstName: "T",
      lastName: "Case",
      assignedRepId: repId,
      ...(opts.sold ? { stageId: soldStageId } : {}),
    },
  });
  if (opts.contractValue != null) {
    await db.project.create({
      data: {
        companyId,
        vertical: "roofing",
        leadId: lead.id,
        projectNumber: `J-${lead.id.slice(0, 8)}`,
        status: "not_started",
        contractValue: opts.contractValue,
      },
    });
  }
  return lead;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Team Grouping Co", slug: `teams-${process.pid}-${Date.now()}` },
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

  adminId = (await mk("admin", "admin")).id;
  // A named team and an unnamed one, so both label paths are exercised.
  alphaMgrId = (await mk("alpha", "manager", { teamName: "Team Alpha" })).id;
  unnamedMgrId = (await mk("beta", "manager")).id;
  alphaRepId = (await mk("arep", "sales_rep", { managerId: alphaMgrId })).id;
  // Second level: reports to a rep, and reaches the team only through them.
  alphaCanvasserId = (await mk("acanv", "canvasser", { salesRepId: alphaRepId })).id;
  unnamedRepId = (await mk("brep", "sales_rep", { managerId: unnamedMgrId })).id;
  // Under nobody at all — the "No team" bucket.
  loneRepId = (await mk("lone", "sales_rep")).id;

  const pipeline = await db.pipeline.create({ data: { companyId, name: "P", vertical: "roofing" } });
  soldStageId = (await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "s1", name: "Contract Signed", position: 0, countsAsSold: true },
  })).id;

  // Team Alpha: 3 appts, 2 won, $8,000 written.
  await deal(alphaRepId, { sold: true, contractValue: 500_000 });
  await deal(alphaRepId);
  await deal(alphaCanvasserId, { sold: true, contractValue: 300_000 });
  // The manager selling on their own team.
  await deal(alphaMgrId);
  // Beta (unnamed): 1 appt, 1 won.
  await deal(unnamedRepId, { sold: true, contractValue: 100_000 });
  // Nobody's team.
  await deal(loneRepId, { sold: true });
  // No rep at all: outside every team AND outside every row.
  await deal(null);
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const run = () =>
  runInVertical("roofing", () => getTeamPerformance(session(adminId, "admin"), "roofing", ALL));

describe("teamKeyOf", () => {
  it("puts a manager on their own team, and everyone else up the chain", () => {
    expect(teamKeyOf({ id: "m", role: "manager", managerId: null, salesRep: null })).toBe("m");
    expect(teamKeyOf({ id: "r", role: "sales_rep", managerId: "m", salesRep: null })).toBe("m");
    // A canvasser reaches the team through their rep, never directly.
    expect(teamKeyOf({ id: "c", role: "canvasser", managerId: null, salesRep: { managerId: "m" } })).toBe("m");
    expect(teamKeyOf({ id: "x", role: "sales_rep", managerId: null, salesRep: null })).toBeNull();
  });

  // A manager who somehow reports to another manager still runs their OWN team
  // — otherwise naming a team would silently move its whole roster.
  it("keeps a manager on their own team even when they report upward", () => {
    expect(teamKeyOf({ id: "m2", role: "manager", managerId: "boss", salesRep: null })).toBe("m2");
  });
});

describe("getTeamPerformance — by team", () => {
  it("groups the manager, their reps, and the canvassers under those reps", async () => {
    const data = await run();
    const alpha = data.teams.find((t) => t.managerId === alphaMgrId);
    expect(alpha).toBeDefined();
    expect(alpha!.name).toBe("Team Alpha");
    expect(alpha!.named).toBe(true);
    expect(new Set(alpha!.members.map((m) => m.userId))).toEqual(
      new Set([alphaMgrId, alphaRepId, alphaCanvasserId]),
    );
  });

  it("falls back to the manager's name when the team has none", async () => {
    const data = await run();
    const beta = data.teams.find((t) => t.managerId === unnamedMgrId);
    expect(beta!.name).toBe("beta User's team");
    expect(beta!.named).toBe(false);
  });

  it("adds a team up to exactly the sum of its own members' rows", async () => {
    const data = await run();
    const alpha = data.teams.find((t) => t.managerId === alphaMgrId)!;
    const sum = (pick: (r: (typeof alpha.members)[number]) => number) =>
      alpha.members.reduce((n, m) => n + pick(m), 0);
    expect(alpha.appointments).toBe(sum((m) => m.appointments));
    expect(alpha.won).toBe(sum((m) => m.won));
    expect(alpha.installs).toBe(sum((m) => m.installs));
    expect(alpha.soldCents).toBe(sum((m) => m.soldCents ?? 0));
    // And the figures themselves, so a refactor that keeps them self-consistent
    // but wrong still fails.
    expect(alpha.appointments).toBe(4);
    expect(alpha.won).toBe(2);
    expect(alpha.soldCents).toBe(800_000);
    expect(alpha.closeRatePct).toBe(50);
  });

  it("keeps people under no manager in a No team row, sorted last", async () => {
    const data = await run();
    const none = data.teams.find((t) => t.managerId === null);
    expect(none).toBeDefined();
    expect(none!.name).toBe("No team");
    expect(none!.members.map((m) => m.userId)).toContain(loneRepId);
    // Last whatever it scored: a gap in the org chart is not a team to beat.
    expect(data.teams[data.teams.length - 1]).toBe(none);
  });

  it("loses nobody: every rep row lands on exactly one team", async () => {
    const data = await run();
    const grouped = data.teams.flatMap((t) => t.members.map((m) => m.userId));
    expect(grouped.length).toBe(new Set(grouped).size);
    expect(new Set(grouped)).toEqual(new Set(data.rows.map((r) => r.userId)));
  });
});
