import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import type { AgentHandler } from "../types";

/**
 * The apply deadline is checked at the top of EVERY move, not once before the
 * loop starts. `pastApplyDeadline` is mocked to flip from false to true after
 * its first call, so the second of several changes lands "too late" without
 * the test waiting out the real 285-second budget. This lives in its own
 * file because vi.mock is hoisted for the whole file, and only this file
 * needs `pastApplyDeadline` itself to misbehave.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => {
  const anyConfig = (raw: unknown) => ({ ok: true as const, config: raw as { moves: { leadId: string; to: string }[] } });
  const handlers: Record<string, AgentHandler> = {
    "test.multimove": {
      key: "test.multimove" as AgentHandler["key"],
      label: "multimove",
      parseConfig: anyConfig,
      async run(ctx) {
        const { moves } = ctx.config as { moves: { leadId: string; to: string }[] };
        return {
          status: "success",
          summary: "Moved several",
          changes: moves.map((m) => ({ type: "move_stage" as const, leadId: m.leadId, toStageKey: m.to, reason: "batch" })),
        };
      },
    },
  };
  return { handlers };
});

vi.mock("../registry", () => ({
  handlerFor: (key: string) => t.handlers[key] ?? null,
  handlerOptions: () => [],
  HANDLERS: {},
}));

vi.mock("../budget", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../budget")>();
  let calls = 0;
  return {
    ...actual,
    pastApplyDeadline: (...args: Parameters<typeof actual.pastApplyDeadline>) => {
      calls += 1;
      return calls > 1 ? true : actual.pastApplyDeadline(...args);
    },
  };
});

import { AGENT_SELECT, createRun, executeRun } from "../runner";
import { readDetail } from "../detail";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let pipelineId = "";
let leadA = "";
let leadB = "";
let leadC = "";
const stage: Record<string, string> = {};
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Deadline Co", slug: `deadline-${process.pid}-${Date.now()}` } })).id;
  await db.user.create({
    data: { companyId, email: `owner-${process.pid}@deadline.test`, firstName: "Olive", lastName: "Owner", role: "super_admin", status: "active", passwordHash: "x" },
  });
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  const defs = [
    ["from", "From", false],
    ["side", "Side", true],
    ["main", "Main", false],
  ] as const;
  for (const [position, [key, name, isActionRequired]] of defs.entries()) {
    stage[key] = (await db.pipelineStage.create({ data: { pipelineId, key, name, position, isActionRequired } })).id;
  }
  for (const [event, title] of [["agent_run_failed", "Agent failed: {{agent}}"]] as const) {
    await db.notificationRule.create({
      data: { companyId, vertical: "roofing", name: event, event, recipients: { roles: ["super_admin"], userIds: [], dynamic: [] }, channels: ["in_app"], titleTemplate: title, bodyTemplate: "{{status}}" },
    });
  }
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadA = (await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Ann", lastName: "A" } })).id;
  leadB = (await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Bea", lastName: "B" } })).id;
  leadC = (await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Cid", lastName: "C" } })).id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const agent = (handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: { companyId, name: `Agent ${++seq}`, handlerKey, department: "operations", timeoutSeconds: 60, ...over },
    select: AGENT_SELECT,
  });

describe("the apply deadline is reached mid-run", () => {
  it("discards the remaining changes with the deadline note, fails the run, and keeps only the first move", async () => {
    const a = await agent("test.multimove", {
      requiresHumanGate: false,
      config: {
        moves: [
          { leadId: leadA, to: "side" },
          { leadId: leadB, to: "main" },
          { leadId: leadC, to: "main" },
        ],
      },
    });
    const result = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
    const { id } = result!;
    const status = await executeRun(id, { owned: true });
    expect(status).toBe("failed");

    const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("failed");
    expect(row.summary).toMatch(/^Failed: the run passed its apply deadline after applying 1 of 3 changes\.$/);
    const detail = readDetail(row.detail);

    expect(detail.changes[0]).toMatchObject({ leadId: leadA, outcome: "applied" });
    expect(detail.changes[1]).toMatchObject({ leadId: leadB, outcome: "discarded", note: "Not applied: the run reached its apply deadline." });
    expect(detail.changes[2]).toMatchObject({ leadId: leadC, outcome: "discarded", note: "Not applied: the run reached its apply deadline." });
    expect(detail.changes.some((c) => c.outcome === "held")).toBe(false);

    expect((await db.lead.findUniqueOrThrow({ where: { id: leadA } })).stageId).toBe(stage.side);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadB } })).stageId).toBe(stage.from);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadC } })).stageId).toBe(stage.from);
  });
});
