import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Run now, when ONE of a "both workspaces" agent's two runs cannot be started.
 *
 * `hasRunInFlight` and the `agent_runs_one_in_flight` partial unique index ask
 * exactly the same question, so the only way one workspace is refused while the
 * other starts is a genuine race between that check and the insert — which is
 * precisely what `createRun` returning null means. A real concurrent-insert
 * test would be non-deterministic about WHICH workspace lost, so `createRun` is
 * mocked to lose the workspaces this file names, and nothing else about the
 * action is stood in for.
 *
 * Its own file because `vi.mock` is hoisted for the whole file, and every other
 * test of this action needs the real `createRun`.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const t = vi.hoisted(() => ({ refuse: new Set<string>() }));

vi.mock("../runner", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../runner")>();
  return {
    ...actual,
    createRun: vi.fn(async (input: Parameters<typeof actual.createRun>[0]) =>
      t.refuse.has(input.vertical) ? null : actual.createRun(input)
    ),
    // This file is about which ROWS the action writes, not what they then do.
    // A real executeRun would run in the background off after() below and
    // still be writing while afterAll tore the fixtures down.
    executeRun: vi.fn(async () => "success" as const),
  };
});

type Current = {
  userId: string;
  companyId: string;
  role: Role;
  permissions: Record<string, unknown>;
  verticals: ("roofing" | "solar")[];
  fullName: string;
};
let current: Current;

vi.mock("@/server/auth/session", () => ({ requireUser: async () => current, getSessionUser: async () => current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    void Promise.resolve().then(fn);
  },
}));

const actions = await import("../actions");

let companyId = "";
let bothAgentId = "";

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Race Co", slug: `agent-race-${process.pid}-${Date.now()}` } })).id;
  const userId = (
    await db.user.create({
      data: {
        companyId,
        email: `admin-${process.pid}@agent-race.test`,
        firstName: "Ada",
        lastName: "Admin",
        role: "admin",
        status: "active",
        passwordHash: "x",
        verticals: ["roofing", "solar"],
      },
    })
  ).id;
  bothAgentId = (
    await db.agent.create({ data: { companyId, name: "Both Poller", handlerKey: "system.hello", vertical: null, department: "operations", enabled: true } })
  ).id;
  current = { userId, companyId, role: "admin", permissions: {}, verticals: ["roofing", "solar"], fullName: "Ada Admin" };
});

beforeEach(async () => {
  t.refuse.clear();
  await db.agentRun.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("runAgentNowAction — when a workspace is raced", () => {
  it("starts the workspace it could, and says which one it could not", async () => {
    t.refuse.add("solar");
    const res = await actions.runAgentNowAction(bothAgentId);
    // The user's intent is satisfied either way, so this is still ok — but the
    // button is the one place a person can be told only one of the two started.
    expect(res).toMatchObject({ ok: true, skipped: "solar" });
    if (!res.ok) throw new Error("expected the run to start");
    expect(res.runIds).toHaveLength(1);
    expect((await db.agentRun.findMany({ where: { agentId: bothAgentId }, select: { vertical: true } })).map((r) => r.vertical)).toEqual(["roofing"]);
  });

  it("skips nothing when both workspaces start", async () => {
    const res = await actions.runAgentNowAction(bothAgentId);
    expect(res).toMatchObject({ ok: true, skipped: null });
    if (!res.ok) throw new Error("expected the run to start");
    expect(res.runIds).toHaveLength(2);
  });

  it("fails, naming a workspace, only when every workspace is raced", async () => {
    t.refuse.add("roofing");
    t.refuse.add("solar");
    expect(await actions.runAgentNowAction(bothAgentId)).toEqual({
      ok: false,
      error: "This agent already has a run in progress in Roofing. Wait for it to finish.",
    });
    expect(await db.agentRun.count({ where: { agentId: bothAgentId } })).toBe(0);
  });
});
