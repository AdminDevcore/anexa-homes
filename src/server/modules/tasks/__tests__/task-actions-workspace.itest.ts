import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * The Tasks page's two buttons — tick a task done, delete a task — through the
 * real server actions and the real (extended) app client, inside a workspace.
 *
 * With SOLAR_VERTICAL_ENABLED on, both used to throw before reaching the
 * database: the SCOPED_OPTIONAL filter wrapped `where: { id }` in an AND, and
 * Prisma refuses a unique op whose `id` is not at the top level. The unit of
 * proof is the action, not the extension, so a future refactor of either cannot
 * quietly bring the break back.
 *
 * `can()` and `listScope()` are not mocked. The sales-rep case matters: its
 * listScope carries its own `OR` (assigned to me OR created by me), which the
 * workspace filter must narrow rather than overwrite.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let current: {
  userId: string;
  companyId: string;
  role: string;
  fullName: string;
  permissions: Record<string, unknown>;
};

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { runInVertical } = await import("@/server/vertical/context");
const { setTaskStatusAction, deleteTaskAction } = await import("../actions");

const roofing = <T>(fn: () => Promise<T>) => runInVertical("roofing", fn);

let companyId = "";
let adminId = "";
let repId = "";
let otherRepId = "";
let roofTask = "";
let solarTask = "";
let companyTask = "";
let othersTask = "";

beforeAll(async () => {
  const c = await raw.company.create({
    data: { name: "Task Actions Co", slug: `task-actions-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const mk = async (tag: string, role: "admin" | "sales_rep") =>
    (
      await raw.user.create({
        data: {
          companyId,
          email: `${tag}-${process.pid}-${Date.now()}@task-actions.test`,
          firstName: tag,
          lastName: "User",
          role,
          status: "active",
          passwordHash: "x",
          verticals: ["roofing", "solar"],
        },
      })
    ).id;
  adminId = await mk("admin", "admin");
  repId = await mk("rep", "sales_rep");
  otherRepId = await mk("other", "sales_rep");
});

beforeEach(async () => {
  await raw.task.deleteMany({ where: { companyId } });
  const mk = async (title: string, vertical: "roofing" | "solar" | null, assigneeId = repId) =>
    (await raw.task.create({ data: { companyId, title, vertical, assigneeId, createdById: adminId } })).id;
  roofTask = await mk("Roof task", "roofing");
  solarTask = await mk("Solar task", "solar");
  companyTask = await mk("Company task", null);
  othersTask = await mk("Someone else's", "roofing", otherRepId);
});

afterAll(async () => {
  await raw.company.deleteMany({ where: { id: companyId } });
  await raw.$disconnect();
});

const asAdmin = () => {
  current = { userId: adminId, companyId, role: "admin", fullName: "Admin User", permissions: {} };
};
const asRep = () => {
  current = { userId: repId, companyId, role: "sales_rep", fullName: "Rep User", permissions: {} };
};

describe("setTaskStatusAction inside a workspace", () => {
  it("marks a workspace task and a company task done, stamping who did it", async () => {
    asAdmin();
    expect(await roofing(() => setTaskStatusAction(roofTask, "done"))).toEqual({ ok: true });
    expect(await roofing(() => setTaskStatusAction(companyTask, "done"))).toEqual({ ok: true });

    const rows = await raw.task.findMany({
      where: { id: { in: [roofTask, companyTask] } },
      orderBy: { title: "asc" },
    });
    expect(rows.map((t) => [t.title, t.status, t.vertical, t.completedById])).toEqual([
      ["Company task", "done", null, adminId], // still company-level after the edit
      ["Roof task", "done", "roofing", adminId],
    ]);
  });

  it("reopening clears the completion stamp", async () => {
    asAdmin();
    await roofing(() => setTaskStatusAction(roofTask, "done"));
    expect(await roofing(() => setTaskStatusAction(roofTask, "todo"))).toEqual({ ok: true });
    const row = await raw.task.findUniqueOrThrow({ where: { id: roofTask } });
    expect([row.status, row.completedAt, row.completedById]).toEqual(["todo", null, null]);
  });

  it("cannot reach the other workspace's task", async () => {
    asAdmin();
    expect(await roofing(() => setTaskStatusAction(solarTask, "done"))).toEqual({
      ok: false,
      error: "Task not found.",
    });
    expect((await raw.task.findUniqueOrThrow({ where: { id: solarTask } })).status).toBe("todo");
  });

  it("a rep's own-tasks scope (an OR) still narrows inside the workspace", async () => {
    asRep();
    expect(await roofing(() => setTaskStatusAction(roofTask, "in_progress"))).toEqual({ ok: true });
    expect(await roofing(() => setTaskStatusAction(othersTask, "done"))).toEqual({
      ok: false,
      error: "Task not found.",
    });
    const rows = await raw.task.findMany({
      where: { id: { in: [roofTask, othersTask] } },
      orderBy: { title: "asc" },
    });
    expect(rows.map((t) => [t.title, t.status])).toEqual([
      ["Roof task", "in_progress"],
      ["Someone else's", "todo"],
    ]);
  });
});

describe("deleteTaskAction inside a workspace", () => {
  it("deletes a workspace task and a company task", async () => {
    asAdmin();
    expect(await roofing(() => deleteTaskAction(roofTask))).toEqual({ ok: true });
    expect(await roofing(() => deleteTaskAction(companyTask))).toEqual({ ok: true });
    const left = await raw.task.findMany({ where: { companyId }, select: { id: true } });
    expect(left.map((t) => t.id).sort()).toEqual([solarTask, othersTask].sort());
  });

  it("a sales rep cannot delete another user's task, only their own", async () => {
    asRep();
    // Same company, same workspace, reachable by id — only the rep's own-tasks
    // scope can refuse this. It used to check companyId alone.
    expect(await roofing(() => deleteTaskAction(othersTask))).toEqual({
      ok: false,
      error: "Task not found.",
    });
    expect(await raw.task.count({ where: { id: othersTask } })).toBe(1);

    expect(await roofing(() => deleteTaskAction(roofTask))).toEqual({ ok: true });
    expect(await raw.task.count({ where: { id: roofTask } })).toBe(0);
  });

  it("cannot delete the other workspace's task", async () => {
    asAdmin();
    expect(await roofing(() => deleteTaskAction(solarTask))).toEqual({
      ok: false,
      error: "Task not found.",
    });
    expect(await raw.task.count({ where: { id: solarTask } })).toBe(1);
  });
});
