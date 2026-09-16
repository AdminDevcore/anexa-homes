import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import type { AgentHandler } from "../types";

/**
 * The runner against a real database, with handlers written to misbehave.
 *
 * Every case reads the run ROW back, because the row is the promise: whatever a
 * handler does — succeed, throw, hang, return junk, ask for a move the gate
 * refuses — a person can open the run and see what happened.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => {
  const state = { aborted: false, waiting: false, release: () => {} };
  const anyConfig = (raw: unknown) => ({ ok: true as const, config: raw as { leadId: string; to: string } });
  const handlers: Record<string, AgentHandler> = {
    "test.ok": {
      key: "test.ok" as AgentHandler["key"],
      label: "ok",
      parseConfig: anyConfig,
      async run(ctx) {
        ctx.log("line one");
        return { status: "success", summary: "All good", detail: { checked: 3 } };
      },
    },
    "test.throws": {
      key: "test.throws" as AgentHandler["key"],
      label: "throws",
      parseConfig: anyConfig,
      async run() {
        throw new Error("portal said no");
      },
    },
    "test.hangs": {
      key: "test.hangs" as AgentHandler["key"],
      label: "hangs",
      parseConfig: anyConfig,
      run(ctx) {
        ctx.signal.addEventListener("abort", () => {
          state.aborted = true;
        });
        return new Promise(() => {});
      },
    },
    "test.junk": {
      key: "test.junk" as AgentHandler["key"],
      label: "junk",
      parseConfig: anyConfig,
      async run() {
        return { status: "done" } as never;
      },
    },
    "test.picky": {
      key: "test.picky" as AgentHandler["key"],
      label: "picky",
      parseConfig: () => ({ ok: false as const, error: "needs a portal" }),
      async run() {
        return { status: "success", summary: "unreachable" };
      },
    },
    "test.move": {
      key: "test.move" as AgentHandler["key"],
      label: "move",
      parseConfig: anyConfig,
      async run(ctx) {
        const { leadId, to } = ctx.config as { leadId: string; to: string };
        return { status: "success", summary: "Moved", changes: [{ type: "move_stage", leadId, toStageKey: to, reason: "portal says so" }] };
      },
    },
    "test.fails_with_move": {
      key: "test.fails_with_move" as AgentHandler["key"],
      label: "fails with move",
      parseConfig: anyConfig,
      async run(ctx) {
        const { leadId, to } = ctx.config as { leadId: string; to: string };
        return { status: "failed", summary: "Portal down", error: "503", changes: [{ type: "move_stage", leadId, toStageKey: to, reason: "x" }] };
      },
    },
    "test.waits": {
      key: "test.waits" as AgentHandler["key"],
      label: "waits",
      parseConfig: anyConfig,
      async run() {
        state.waiting = true;
        await new Promise<void>((resolve) => {
          state.release = resolve;
        });
        return { status: "success", summary: "Late" };
      },
    },
    "test.parse_throws": {
      key: "test.parse_throws" as AgentHandler["key"],
      label: "parse throws",
      parseConfig: () => {
        throw new Error("parseConfig blew up");
      },
      async run() {
        return { status: "success", summary: "unreachable" };
      },
    },
    "test.nul": {
      key: "test.nul" as AgentHandler["key"],
      label: "nul",
      parseConfig: anyConfig,
      async run(ctx) {
        ctx.log("line\u0000one");
        return { status: "success", summary: "All good\u0000" };
      },
    },
    "test.logs_lots": {
      key: "test.logs_lots" as AgentHandler["key"],
      label: "logs a lot",
      parseConfig: anyConfig,
      async run(ctx) {
        for (let i = 0; i < 600; i++) ctx.log(i === 0 ? "x".repeat(3000) : `line ${i}`);
        return { status: "success", summary: "Logged a lot" };
      },
    },
    "test.date_detail": {
      key: "test.date_detail" as AgentHandler["key"],
      label: "date in detail",
      parseConfig: anyConfig,
      async run(ctx) {
        return { status: "success", summary: "Timestamped", detail: { at: ctx.deps.now() } };
      },
    },
  };
  return { state, handlers };
});

vi.mock("../registry", () => ({
  handlerFor: (key: string) => t.handlers[key] ?? null,
  handlerOptions: () => [],
  HANDLERS: {},
}));

import { AGENT_SELECT, MAX_LOG_LINE_CHARS, MAX_LOG_LINES, createRun, executeRun, writeMissingHandlerRun } from "../runner";
import { readDetail } from "../detail";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let ownerId = "";
let pipelineId = "";
let solarPipelineId = "";
let leadId = "";
const stage: Record<string, string> = {};
const solarStage: Record<string, string> = {};
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Runner Co", slug: `runner-${process.pid}-${Date.now()}` } })).id;
  ownerId = (
    await db.user.create({ data: { companyId, email: `owner-${process.pid}@runner.test`, firstName: "Olive", lastName: "Owner", role: "super_admin", status: "active", passwordHash: "x" } })
  ).id;
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  const defs = [
    ["from", "From", false],
    ["side", "Side", true],
    ["main", "Main", false],
  ] as const;
  for (const [position, [key, name, isActionRequired]] of defs.entries()) {
    stage[key] = (await db.pipelineStage.create({ data: { pipelineId, key, name, position, isActionRequired } })).id;
  }

  // Solar pipeline for testing Contract Signed and M1 Funding rules
  solarPipelineId = (await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } })).id;
  solarStage.initial = (await db.pipelineStage.create({ data: { pipelineId: solarPipelineId, key: "initial", name: "Initial", position: 0 } })).id;
  solarStage.contractSigned = (
    await db.pipelineStage.create({
      data: { pipelineId: solarPipelineId, key: "contract_signed_stage", name: "Contract Signed", position: 1, milestone: "contract_signed" },
    })
  ).id;
  solarStage.m1Funding = (
    await db.pipelineStage.create({ data: { pipelineId: solarPipelineId, key: "m1_funding", name: "M1 Funding", position: 2 } })
  ).id;

  for (const [event, title] of [
    ["agent_run_failed", "Agent failed: {{agent}}"],
    ["agent_needs_human", "Needs a human: {{agent}}"],
  ] as const) {
    await db.notificationRule.create({
      data: { companyId, vertical: "roofing", name: event, event, recipients: { roles: ["super_admin"], userIds: [], dynamic: [] }, channels: ["in_app"], titleTemplate: title, bodyTemplate: "{{status}}" },
    });
    await db.notificationRule.create({
      data: { companyId, vertical: "solar", name: event, event, recipients: { roles: ["super_admin"], userIds: [], dynamic: [] }, channels: ["in_app"], titleTemplate: title, bodyTemplate: "{{status}}" },
    });
  }
  // A rule waiting at the side-state, to prove an agent's move sets automations off.
  await db.automationRule.create({
    data: { companyId, vertical: "roofing", name: "Side → Main", trigger: "stage_entered", conditions: { stageId: stage.side }, actions: [{ type: "move_stage", stageId: stage.main }] },
  });
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
  t.state.aborted = false;
  t.state.waiting = false;
  t.state.release = () => {};
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.solarMilestone.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [pipelineId, solarPipelineId] } } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const agent = (handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: { companyId, name: `Agent ${++seq}`, handlerKey, department: "operations", timeoutSeconds: 60, ...over },
    select: AGENT_SELECT,
  });

async function runOf(handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}, opts: Parameters<typeof executeRun>[1] = {}, vertical: "roofing" | "solar" = "roofing") {
  const a = await agent(handlerKey, over);
  const result = await createRun({ agent: a, vertical, trigger: "manual", status: "running" });
  const { id } = result!;
  const status = await executeRun(id, { owned: true, ...opts });
  const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
  return { status, row, detail: readDetail(row.detail) };
}

const stageOfLead = async () => (await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId;

describe("executeRun", () => {
  it("records a success with its summary, log, handler detail and duration", async () => {
    const { status, row, detail } = await runOf("test.ok");
    expect(status).toBe("success");
    expect(row).toMatchObject({ status: "success", summary: "All good", error: null });
    expect(row.finishedAt).not.toBeNull();
    expect(detail.log).toEqual(["line one"]);
    expect(detail.handler).toEqual({ checked: 3 });
    expect(detail.durationMs).toBeGreaterThanOrEqual(0);
    expect(await db.notification.count({ where: { companyId } })).toBe(0);
  });

  it("records a throw as failed, keeps the stack, and tells the owner", async () => {
    const { row } = await runOf("test.throws");
    expect(row).toMatchObject({ status: "failed", summary: "Handler threw: portal said no" });
    expect(row.error).toContain("Error: portal said no");
    expect(row.error).toContain("at ");
    const n = await db.notification.findFirst({ where: { companyId, userId: ownerId } });
    expect(n?.title).toMatch(/^Agent failed: Agent \d+$/);
  });

  it("stops waiting at the deadline, aborts the handler, and fails the run", async () => {
    const { row } = await runOf("test.hangs", {}, { maxHandlerMs: 100 });
    expect(row).toMatchObject({ status: "failed", summary: "Timed out after 1 s." });
    expect(t.state.aborted).toBe(true);
  });

  it("fails a run whose handler returns something that is not a result", async () => {
    const { row } = await runOf("test.junk");
    expect(row.status).toBe("failed");
    expect(row.error).toMatch(/invalid result/i);
  });

  it("fails a run whose handler is not deployed, with the fix in the message", async () => {
    const { row } = await runOf("bank.ntp_poll");
    expect(row).toMatchObject({
      status: "failed",
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
  });

  it("fails a run whose config the handler refuses", async () => {
    const { row } = await runOf("test.picky");
    expect(row).toMatchObject({ status: "failed", summary: "Config is invalid: needs a portal" });
  });

  it("ends the run failed, not stuck running, when parseConfig itself throws", async () => {
    const { row } = await runOf("test.parse_throws");
    expect(row.status).toBe("failed");
    expect(row.summary).toMatch(/^The runner crashed:/);
    expect(row.finishedAt).not.toBeNull();
  });

  it("strips NUL bytes from the stored summary and log", async () => {
    const { row, detail } = await runOf("test.nul");
    expect(row.status).toBe("success");
    expect(row.summary).toBe("All good");
    expect(row.summary).not.toContain("\u0000");
    expect(detail.log[0]).toBe("lineone");
    expect(detail.log[0]).not.toContain("\u0000");
  });

  it("caps the log at 500 lines plus a dropped-lines marker, each line bounded", async () => {
    const { detail } = await runOf("test.logs_lots");
    expect(detail.log).toHaveLength(MAX_LOG_LINES + 1);
    expect(detail.log[MAX_LOG_LINES]).toBe("… further lines dropped");
    expect(detail.log[0]).toHaveLength(MAX_LOG_LINE_CHARS);
    for (const line of detail.log) expect(line.length).toBeLessThanOrEqual(MAX_LOG_LINE_CHARS);
  });

  it("keeps a Date in the handler's own detail as its ISO string, not {}", async () => {
    const { row, detail } = await runOf("test.date_detail");
    expect(row.status).toBe("success");
    expect(typeof (detail.handler as { at: unknown })?.at).toBe("string");
    expect((detail.handler as { at: string }).at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

describe("the gate, applied", () => {
  it("lets a gated agent move a deal into an Action Required stage, like a person would, and automations fire", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: true, config: { leadId, to: "side" } });
    expect(row.status).toBe("success");
    expect(detail.changes[0]).toMatchObject({ outcome: "applied", dealLabel: "Maria Lopez · 12 Elm St", fromStage: { key: "from" }, toStage: { key: "side" } });
    const events = await db.leadStageEvent.findMany({ where: { leadId }, orderBy: { enteredAt: "asc" } });
    expect(events.map((e) => [e.stageName, e.via])).toEqual([
      ["Side", "agent"],
      ["Main", "automation"],
    ]);
    expect(await db.activityLog.count({ where: { leadId, message: { contains: "moved the deal to Side" } } })).toBe(1);
    expect(await db.automationRun.count({ where: { leadId } })).toBeGreaterThan(0);
  });

  it("holds a gated move onto the main line for a human, and says so", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: true, config: { leadId, to: "main" } });
    expect(row.status).toBe("needs_human");
    expect(detail.changes[0]).toMatchObject({ outcome: "held" });
    expect(await stageOfLead()).toBe(stage.from);
    const n = await db.notification.findFirst({ where: { companyId, userId: ownerId } });
    expect(n?.title).toMatch(/^Needs a human: /);
  });

  it("lets an ungated agent move a deal anywhere in its pipeline", async () => {
    const { row } = await runOf("test.move", { requiresHumanGate: false, config: { leadId, to: "main" } });
    expect(row.status).toBe("success");
    expect(await stageOfLead()).toBe(stage.main);
  });

  it("applies nothing when the handler itself reports failure", async () => {
    const { row, detail } = await runOf("test.fails_with_move", { requiresHumanGate: false, config: { leadId, to: "main" } });
    expect(row).toMatchObject({ status: "failed", summary: "Portal down", error: "503" });
    expect(detail.changes[0]).toMatchObject({ outcome: "discarded" });
    expect(await stageOfLead()).toBe(stage.from);
  });

  it("fails the run and applies nothing when a change names a stage that is not there", async () => {
    const { row, detail } = await runOf("test.move", { requiresHumanGate: false, config: { leadId, to: "nowhere" } });
    expect(row.status).toBe("failed");
    expect(detail.changes[0]).toMatchObject({ outcome: "invalid" });
    expect(await stageOfLead()).toBe(stage.from);
  });
});

describe("solar stage rules", () => {
  it("fails the run when an ungated agent moves a solar deal past Contract Signed without evidence", async () => {
    const solarLead = (
      await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipelineId, stageId: solarStage.initial, firstName: "Sol", lastName: "Customer" } })
    ).id;
    await db.leadStageEvent.create({
      data: { leadId: solarLead, stageId: solarStage.initial, stageName: "Initial", position: 0 },
    });
    const { row, detail } = await runOf("test.move", { requiresHumanGate: false, config: { leadId: solarLead, to: "contract_signed_stage" } }, {}, "solar");
    expect(row.status).toBe("failed");
    expect(detail.changes[0]).toMatchObject({ outcome: "invalid" });
    expect(detail.changes[0].note).toMatch(/Contract Signed needs both/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarLead } })).stageId).toBe(solarStage.initial);
  });

  it("fails the run when an ungated agent moves a solar deal past M1 Funding with nothing certified", async () => {
    const solarLead = (
      await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipelineId, stageId: solarStage.contractSigned, firstName: "Fund", lastName: "Test" } })
    ).id;
    await db.leadStageEvent.create({
      data: { leadId: solarLead, stageId: solarStage.contractSigned, stageName: "Contract Signed", position: 1 },
    });
    const { row, detail } = await runOf("test.move", { requiresHumanGate: false, config: { leadId: solarLead, to: "m1_funding" } }, {}, "solar");
    expect(row.status).toBe("failed");
    expect(detail.changes[0]).toMatchObject({ outcome: "invalid" });
    expect(detail.changes[0].note).toMatch(/M1 Funding/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarLead } })).stageId).toBe(solarStage.contractSigned);
  });

  it("holds a gated agent's request to move a solar deal past M1 Funding for a human", async () => {
    const solarLead = (
      await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipelineId, stageId: solarStage.contractSigned, firstName: "Gated", lastName: "Move" } })
    ).id;
    await db.leadStageEvent.create({
      data: { leadId: solarLead, stageId: solarStage.contractSigned, stageName: "Contract Signed", position: 1 },
    });
    const { row, detail } = await runOf("test.move", { requiresHumanGate: true, config: { leadId: solarLead, to: "m1_funding" } }, {}, "solar");
    expect(row.status).toBe("needs_human");
    expect(detail.changes[0]).toMatchObject({ outcome: "held" });
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarLead } })).stageId).toBe(solarStage.contractSigned);
  });
});

describe("ownership", () => {
  it("executes a queued run exactly once, however many callers race for it", async () => {
    const a = await agent("test.ok");
    const result = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" });
    const { id } = result!;
    const results = await Promise.all([executeRun(id), executeRun(id)]);
    expect(results.filter((r) => r === null)).toHaveLength(1);
    expect((await db.agentRun.findUniqueOrThrow({ where: { id } })).status).toBe("success");
  });

  it("keeps the reaper's verdict and files the late result beside it", async () => {
    const a = await agent("test.waits");
    const result = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
    const { id } = result!;
    const pending = executeRun(id, { owned: true });
    await vi.waitFor(() => expect(t.state.waiting).toBe(true), { timeout: 5000 });
    await db.agentRun.update({ where: { id }, data: { status: "failed", finishedAt: new Date(), summary: "Reaped", error: "Reaped" } });
    t.state.release();
    expect(await pending).toBe("failed");
    const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
    expect(row.summary).toBe("Reaped");
    expect(readDetail(row.detail).lateResult).toMatchObject({ status: "success", summary: "Late" });
  });

  it("race two createRun calls for the same agent and workspace: one succeeds, one returns null", async () => {
    const a = await agent("test.ok");
    const results = await Promise.all([
      createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" }),
      createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" }),
    ]);
    expect(results.filter((r) => r !== null)).toHaveLength(1);
    expect(results.filter((r) => r === null)).toHaveLength(1);
  });

  it("finished run does not block a new one", async () => {
    const a = await agent("test.ok");
    const result1 = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
    const { id: id1 } = result1!;
    await executeRun(id1, { owned: true });
    const result2 = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" });
    expect(result2).not.toBeNull();
  });

  it("returns null and runs nothing when told it owns a run that is not running", async () => {
    const a = await agent("test.ok");
    const result = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "queued" });
    const { id } = result!;
    const status = await executeRun(id, { owned: true });
    expect(status).toBeNull();
    expect((await db.agentRun.findUniqueOrThrow({ where: { id } })).status).toBe("queued");
  });
});

describe("writeMissingHandlerRun", () => {
  it("writes the failed run straight away and announces it", async () => {
    const a = await agent("bank.ntp_poll");
    const { id, error } = await writeMissingHandlerRun({ agent: a, vertical: "roofing", trigger: "scheduled" });
    expect(error).toMatch(/bank\.ntp_poll/);
    expect(await db.agentRun.findUniqueOrThrow({ where: { id } })).toMatchObject({ status: "failed", trigger: "scheduled" });
    expect(await db.notification.count({ where: { companyId, userId: ownerId } })).toBe(1);
  });
});
