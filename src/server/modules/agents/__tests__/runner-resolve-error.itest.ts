import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import type { AgentHandler } from "../types";

/**
 * When resolveChanges throws, the run is marked failed, its changes are discarded,
 * and no move is applied. This lives in its own file because vi.mock is hoisted
 * for the entire file, and we need to mock apply-changes to make resolveChanges
 * throw without affecting the rest of the runner logic.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const t = vi.hoisted(() => {
  const anyConfig = (raw: unknown) => ({ ok: true as const, config: raw as { leadId: string; to: string } });
  const handlers: Record<string, AgentHandler> = {
    "test.move": {
      key: "test.move" as AgentHandler["key"],
      label: "move",
      parseConfig: anyConfig,
      async run(ctx) {
        const { leadId, to } = ctx.config as { leadId: string; to: string };
        return { status: "success", summary: "Moved", changes: [{ type: "move_stage", leadId, toStageKey: to, reason: "portal says so" }] };
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

// Mock apply-changes so that resolveChanges throws while everything else works
vi.mock("../apply-changes", async () => {
  const actual = await vi.importActual<typeof import("../apply-changes")>("../apply-changes");
  return {
    ...actual,
    resolveChanges: vi.fn(async () => {
      throw new Error("resolveChanges: database connection lost");
    }),
  };
});

import { AGENT_SELECT, createRun, executeRun } from "../runner";
import { readDetail } from "../detail";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let pipelineId = "";
let leadId = "";
const stage: Record<string, string> = {};
let seq = 0;

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Resolve Error Co", slug: `resolve-error-${process.pid}-${Date.now()}` } })).id;
  await db.user.create({
    data: { companyId, email: `owner-${process.pid}@resolve-error.test`, firstName: "Olive", lastName: "Owner", role: "super_admin", status: "active", passwordHash: "x" },
  });
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  const defs = [
    ["from", "From", false],
    ["to", "To", false],
  ] as const;
  for (const [position, [key, name, isActionRequired]] of defs.entries()) {
    stage[key] = (await db.pipelineStage.create({ data: { pipelineId, key, name, position, isActionRequired } })).id;
  }
  for (const [event, title] of [["agent_run_failed", "Agent failed: {{agent}}"] as const]) {
    await db.notificationRule.create({
      data: { companyId, vertical: "roofing", name: event, event, recipients: { roles: ["super_admin"], userIds: [], dynamic: [] }, channels: ["in_app"], titleTemplate: title, bodyTemplate: "{{status}}" },
    });
  }
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
});

afterAll(async () => {
  await db.notification.deleteMany({ where: { companyId } });
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

const agent = (handlerKey: string, over: Partial<Prisma.AgentUncheckedCreateInput> = {}) =>
  db.agent.create({
    data: { companyId, name: `Agent ${++seq}`, handlerKey, department: "operations", timeoutSeconds: 60, ...over },
    select: AGENT_SELECT,
  });

describe("resolveChanges throws", () => {
  it("fails the run with changes marked discarded and no move applied", async () => {
    const a = await agent("test.move", { config: { leadId, to: "to" } });
    const result = await createRun({ agent: a, vertical: "roofing", trigger: "manual", status: "running" });
    const { id } = result!;
    const status = await executeRun(id, { owned: true });
    expect(status).toBe("failed");

    const row = await db.agentRun.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("failed");
    expect(row.summary).toMatch(/^Failed while checking changes:/);
    expect(row.finishedAt).not.toBeNull();

    const detail = readDetail(row.detail);
    expect(detail.changes[0]).toMatchObject({ outcome: "discarded", note: "Not applied: the changes could not be checked." });
  });
});
