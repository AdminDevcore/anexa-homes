import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * One minute of the clock, against a real database: due agents run once, two
 * ticks never double a run, the five-run cap holds, and nothing stays running.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => ({
  handlers: {
    "test.ok": {
      key: "test.ok",
      label: "ok",
      parseConfig: (raw: unknown) => ({ ok: true as const, config: raw }),
      async run() {
        return { status: "success" as const, summary: "Ticked" };
      },
    },
  } as Record<string, unknown>,
}));

vi.mock("../registry", () => ({
  handlerFor: (key: string) => t.handlers[key] ?? null,
  handlerOptions: () => [],
  HANDLERS: {},
}));

import { tick } from "../tick";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Tick Co", slug: `tick-${process.pid}-${Date.now()}` } })).id;
});

beforeEach(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  // The tick sees every company in this schema. Leftovers from other files
  // must not take this file's five slots or its reaper counts.
  await db.agent.updateMany({ where: { companyId: { not: companyId }, enabled: true }, data: { enabled: false } });
  await db.agentRun.updateMany({ where: { companyId: { not: companyId }, status: { in: ["queued", "running"] } }, data: { status: "failed" } });
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const dueAgent = (over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: {
      companyId,
      name: `Due ${++seq}`,
      handlerKey: "test.ok",
      department: "operations",
      vertical: "roofing",
      enabled: true,
      schedule: "* * * * *",
      nextRunAt: new Date(Date.now() - 60_000),
      ...over,
    },
  });

const runsOf = (agentId: string) => db.agentRun.findMany({ where: { agentId }, orderBy: { createdAt: "asc" } });
const nextRunOf = async (agentId: string) => (await db.agent.findUniqueOrThrow({ where: { id: agentId } })).nextRunAt;

describe("tick", () => {
  it("runs a due agent once and moves its next run past now", async () => {
    const a = await dueAgent();
    const now = new Date();
    const report = await tick(now);
    expect(report.started).toBe(1);
    expect((await runsOf(a.id)).map((r) => [r.trigger, r.status, r.vertical, r.summary])).toEqual([["scheduled", "success", "roofing", "Ticked"]]);
    expect((await nextRunOf(a.id))!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("claims a due agent exactly once when two ticks run at the same moment", async () => {
    const a = await dueAgent();
    const now = new Date();
    await Promise.all([tick(now), tick(now)]);
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("runs a Both agent once in each live workspace", async () => {
    const a = await dueAgent({ vertical: null });
    await tick(new Date());
    expect((await runsOf(a.id)).map((r) => r.vertical).sort()).toEqual(["roofing", "solar"]);
  });

  it("writes a failed run for a missing handler and keeps the agent on its schedule", async () => {
    const a = await dueAgent({ handlerKey: "bank.ntp_poll" });
    const now = new Date();
    const report = await tick(now);
    expect(report.missingHandler).toBe(1);
    expect((await runsOf(a.id))[0]).toMatchObject({
      status: "failed",
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
    expect((await nextRunOf(a.id))!.getTime()).toBeGreaterThan(now.getTime());
  });

  it("does not start a second run while one is in flight", async () => {
    const a = await dueAgent();
    await db.agentRun.create({ data: { companyId, agentId: a.id, vertical: "roofing", trigger: "manual", status: "running", startedAt: new Date() } });
    await tick(new Date());
    expect(await runsOf(a.id)).toHaveLength(1);
  });

  it("starts at most five runs in one tick, and leaves the rest due", async () => {
    const agents = [];
    for (let i = 0; i < 6; i++) agents.push(await dueAgent({ nextRunAt: new Date(Date.now() - 120_000 + i * 1000) }));
    const now = new Date();
    const report = await tick(now);
    expect(report.started).toBe(5);
    expect(await runsOf(agents[5].id)).toHaveLength(0);
    expect((await nextRunOf(agents[5].id))!.getTime()).toBeLessThanOrEqual(now.getTime());
  });

  it("reaps a run stuck in running and one that never started", async () => {
    // Two agents: the partial unique index agent_runs_one_in_flight refuses two
    // in-flight (queued/running) runs for one agent in one workspace, so the
    // running run and the queued run each need their own agent.
    const a = await dueAgent({ enabled: false, nextRunAt: null, timeoutSeconds: 60 });
    const b = await dueAgent({ enabled: false, nextRunAt: null });
    const now = new Date();
    const stuck = await db.agentRun.create({
      // 365 s ago: past the reaper's 300 s + 60 s grace cutoff on ANY run,
      // regardless of this agent's own 60 s timeoutSeconds.
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "scheduled", status: "running", startedAt: new Date(now.getTime() - 365_000) },
    });
    const never = await db.agentRun.create({
      data: { companyId, agentId: b.id, vertical: "roofing", trigger: "manual", status: "queued", createdAt: new Date(now.getTime() - 11 * 60_000) },
    });
    const report = await tick(now);
    expect(report.reaped).toBe(2);
    const stuckRow = await db.agentRun.findUniqueOrThrow({ where: { id: stuck.id } });
    expect(stuckRow.status).toBe("failed");
    expect(stuckRow.error).toMatch(/^Reaped: still marked running 1 min past the 300 s limit on any run\./);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: never.id } })).toMatchObject({ status: "failed", error: "Never started." });
  });

  it("does not reap a running run inside the 360 s grace window, even past its own timeoutSeconds", async () => {
    const a = await dueAgent({ enabled: false, nextRunAt: null, timeoutSeconds: 60 });
    const now = new Date();
    const run = await db.agentRun.create({
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "scheduled", status: "running", startedAt: new Date(now.getTime() - 200_000) },
    });
    const report = await tick(now);
    expect(report.reaped).toBe(0);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "running" });
  });

  it("starts a manual run that after() never picked up", async () => {
    const a = await dueAgent({ enabled: false, nextRunAt: null });
    const run = await db.agentRun.create({
      data: { companyId, agentId: a.id, vertical: "roofing", trigger: "manual", status: "queued", createdAt: new Date(Date.now() - 31_000) },
    });
    await tick(new Date());
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: run.id } })).toMatchObject({ status: "success", summary: "Ticked" });
  });
});
