import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * THE AGENTS ACCESS SWITCH.
 *
 * Operations is not a role — `manager` is both the sales manager and the solar
 * coordinators — so Operations access to agents is three permission keys on one
 * person. The owner alone sets them, only a manager can be given them, and they
 * do not follow somebody into another role.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { setAgentsAccessAction, updateTeamMemberAction } = await import("../actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };

let companyId = "";
let otherCompanyId = "";
let managerId = "";
let repId = "";
let outsiderId = "";

const member = (cid: string, role: Role, tag: string, permissions: Record<string, unknown> = {}) =>
  db.user.create({
    data: {
      companyId: cid,
      email: `${tag}-${process.pid}@agents-access.test`,
      passwordHash: "x",
      firstName: tag,
      lastName: "Member",
      role,
      verticals: ["roofing"],
      permissions: permissions as Prisma.InputJsonValue,
    },
  });

const as = (role: Role) =>
  session.requireUser.mockResolvedValue({ userId: `${role}-session`, companyId, role, permissions: {} });

const permissionsOf = async (id: string) =>
  (await db.user.findUniqueOrThrow({ where: { id }, select: { permissions: true } })).permissions as Record<string, unknown>;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Agents Access Co", slug: `aa-${process.pid}-${Date.now()}` } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "Other Access Co", slug: `aa-other-${process.pid}-${Date.now()}` } })).id;
});

beforeEach(async () => {
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  managerId = (await member(companyId, "manager", "cora", { "Lead:delete": true })).id;
  repId = (await member(companyId, "sales_rep", "rex")).id;
  outsiderId = (await member(otherCompanyId, "manager", "otto")).id;
  as("super_admin");
});

afterAll(async () => {
  await db.user.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await db.$disconnect();
});

describe("setAgentsAccessAction", () => {
  it("lets the owner turn it on for a manager, keeping every other key", async () => {
    expect(await setAgentsAccessAction({ userId: managerId, on: true })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true, ...SWITCH });
  });

  it("turning it off deletes the three keys and nothing else", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await setAgentsAccessAction({ userId: managerId, on: false })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it.each(["admin", "manager", "accounting"] as const)("refuses a caller who is %s", async (role) => {
    as(role);
    expect(await setAgentsAccessAction({ userId: managerId, on: true })).toMatchObject({ ok: false });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it("refuses anyone who is not a manager, and anyone in another company", async () => {
    expect(await setAgentsAccessAction({ userId: repId, on: true })).toEqual({
      ok: false,
      error: "Agents access can only be given to a manager.",
    });
    expect(await permissionsOf(repId)).toEqual({});
    expect(await setAgentsAccessAction({ userId: outsiderId, on: true })).toEqual({ ok: false, error: "User not found." });
    expect(await permissionsOf(outsiderId)).toEqual({});
  });
});

describe("changing a manager's role", () => {
  it("takes the switch away, and leaves every other key", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await updateTeamMemberAction({ userId: managerId, role: "canvasser" })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true });
  });

  it("keeps it through an edit that leaves the role alone", async () => {
    await setAgentsAccessAction({ userId: managerId, on: true });
    expect(await updateTeamMemberAction({ userId: managerId, title: "Project Coordinator" })).toEqual({ ok: true });
    expect(await permissionsOf(managerId)).toEqual({ "Lead:delete": true, ...SWITCH });
  });
});
