import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A SALES MANAGER'S TEAM NAME.
 *
 * The name is the only thing a "team" is — there is no Team table, because a
 * team is already a manager plus whoever reports to them. That makes two rules
 * load-bearing, and both are enforced on the server rather than by hiding a
 * field: only a manager can hold a name, and losing the manager role takes the
 * name with it. Without the second one, a demoted manager keeps labelling a
 * team on the leaderboard that has nobody in it.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setTeamNameAction, updateTeamMemberAction } = await import("../actions");
const { teamNameOf } = await import("../queries");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let managerId: string;
let repId: string;

const member = (role: Role, tag: string, extra: Record<string, unknown> = {}) =>
  db.user.create({
    data: {
      companyId,
      email: `${tag}-${process.pid}@test.local`,
      passwordHash: "x",
      firstName: tag,
      lastName: "Member",
      role,
      verticals: ["roofing"],
      ...extra,
    },
  });

function asOwner() {
  session.requireUser.mockResolvedValue({
    userId: "owner-session",
    companyId,
    role: "super_admin",
    permissions: {},
  });
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Team Name Co", slug: `tn-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
});

beforeEach(async () => {
  await db.user.deleteMany({ where: { companyId } });
  managerId = (await member("manager", "mgr")).id;
  repId = (await member("sales_rep", "rep", { managerId })).id;
  asOwner();
});

afterAll(async () => {
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("teamNameOf", () => {
  it("reads a manager's own name, and inherits it down the chain", () => {
    expect(teamNameOf({ role: "manager", teamName: "Team Alpha" })).toBe("Team Alpha");
    expect(teamNameOf({ role: "sales_rep", teamName: null, manager: { teamName: "Team Alpha" } })).toBe("Team Alpha");
    expect(
      teamNameOf({ role: "canvasser", teamName: null, salesRep: { manager: { teamName: "Team Alpha" } } }),
    ).toBe("Team Alpha");
  });

  it("is null for somebody under nobody, and for an unnamed team", () => {
    expect(teamNameOf({ role: "sales_rep", teamName: null })).toBeNull();
    expect(teamNameOf({ role: "sales_rep", teamName: null, manager: { teamName: null } })).toBeNull();
    // A stray name on a non-manager row is ignored rather than shown: only a
    // manager has a team, whatever the column happens to hold.
    expect(teamNameOf({ role: "sales_rep", teamName: "Ghost Team" })).toBeNull();
  });
});

describe("setTeamNameAction", () => {
  it("names a manager's team", async () => {
    const res = await setTeamNameAction({ userId: managerId, teamName: "Team Alpha" });
    expect(res.ok).toBe(true);
    expect((await db.user.findUnique({ where: { id: managerId } }))!.teamName).toBe("Team Alpha");
  });

  it("trims, and treats blank as no name at all", async () => {
    await setTeamNameAction({ userId: managerId, teamName: "  Team Kings  " });
    expect((await db.user.findUnique({ where: { id: managerId } }))!.teamName).toBe("Team Kings");
    await setTeamNameAction({ userId: managerId, teamName: "   " });
    // Empty string would render as a blank chip — a team is named or it isn't.
    expect((await db.user.findUnique({ where: { id: managerId } }))!.teamName).toBeNull();
  });

  it("refuses to name a team for anyone who isn't a manager", async () => {
    const res = await setTeamNameAction({ userId: repId, teamName: "Team Alpha" });
    expect(res.ok).toBe(false);
    expect((await db.user.findUnique({ where: { id: repId } }))!.teamName).toBeNull();
  });

  it("refuses somebody who can't edit users", async () => {
    session.requireUser.mockResolvedValue({ userId: repId, companyId, role: "sales_rep", permissions: {} });
    const res = await setTeamNameAction({ userId: managerId, teamName: "Team Mine" });
    expect(res.ok).toBe(false);
  });

  it("won't reach into another company", async () => {
    const other = await db.company.create({ data: { name: "Elsewhere", slug: `tn-other-${process.pid}-${Date.now()}` } });
    const stranger = await db.user.create({
      data: { companyId: other.id, email: `stranger-${process.pid}@test.local`, passwordHash: "x", firstName: "S", lastName: "M", role: "manager" },
    });
    const res = await setTeamNameAction({ userId: stranger.id, teamName: "Team Theirs" });
    expect(res.ok).toBe(false);
    expect((await db.user.findUnique({ where: { id: stranger.id } }))!.teamName).toBeNull();
    await db.company.delete({ where: { id: other.id } });
  });
});

describe("leaving the manager role", () => {
  it("takes the team name with it", async () => {
    await setTeamNameAction({ userId: managerId, teamName: "Team Alpha" });
    const res = await updateTeamMemberAction({ userId: managerId, role: "sales_rep" });
    expect(res.ok).toBe(true);
    expect((await db.user.findUnique({ where: { id: managerId } }))!.teamName).toBeNull();
  });

  it("leaves the name alone when the role isn't changing", async () => {
    await setTeamNameAction({ userId: managerId, teamName: "Team Alpha" });
    // Editing something else on the manager — a title — must not wipe the team.
    const res = await updateTeamMemberAction({ userId: managerId, role: "manager", title: "Sales Director" });
    expect(res.ok).toBe(true);
    expect((await db.user.findUnique({ where: { id: managerId } }))!.teamName).toBe("Team Alpha");
  });
});
