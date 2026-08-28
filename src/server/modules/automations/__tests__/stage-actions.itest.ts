import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { moveStageAction } from "../actions/move-stage";
import { setProjectStatusAction } from "../actions/set-project-status";
import type { ActionContext, StepResult } from "../types";

/**
 * The two actions that advance a job, against a real database.
 *
 * What matters is that they refuse as loudly as they act: a stage from another
 * tenant must not move a deal, and a status set on a deal with no project must
 * be reported rather than shrugged off.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let pipelineId: string;
const stages: Record<string, string> = {};

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Automation Co", slug: `auto-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of ["Installed", "Inspection"].entries()) {
    const s = await db.pipelineStage.create({
      data: { pipelineId, key: `s${i}`, name, position: i },
    });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.project.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

let leadId: string;
beforeEach(async () => {
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId,
      stageId: stages["Installed"],
      firstName: "A",
      lastName: "Homeowner",
    },
  });
  leadId = lead.id;
});

/**
 * Actions are only ever reached through the engine, which establishes the
 * workspace before running anything — Lead and Project are vertical-scoped, so
 * an unwrapped call throws MissingVerticalContextError. The tests call them the
 * same way rather than pretending an action can run outside a workspace.
 */
const run = (
  action: { run: (c: ActionContext) => Promise<StepResult> },
  config: unknown,
  over: Partial<ActionContext> = {}
) =>
  runInVertical("solar", () =>
    action.run({ companyId, vertical: "solar", leadId, config, depth: 0, ...over })
  );

describe("move_stage", () => {
  it("moves the deal and opens a new stage span", async () => {
    const res = await run(moveStageAction, { stageId: stages["Inspection"] });
    expect(res.ok).toBe(true);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Inspection"]);

    const open = await db.leadStageEvent.findFirst({ where: { leadId, exitedAt: null } });
    expect(open?.stageName).toBe("Inspection");
  });

  it("records who did it as the automation, not a person", async () => {
    await run(moveStageAction, { stageId: stages["Inspection"] });
    const log = await db.activityLog.findFirst({ where: { leadId }, orderBy: { createdAt: "desc" } });
    expect(log?.actorId).toBeNull();
    expect(log?.message).toContain("Automation");
  });

  it("fails rather than moving the deal to a stage in another company", async () => {
    const other = await db.company.create({ data: { name: "Other", slug: `oth-${Date.now()}` } });
    const otherPipe = await db.pipeline.create({ data: { companyId: other.id, name: "P" } });
    const otherStage = await db.pipelineStage.create({
      data: { pipelineId: otherPipe.id, key: "x", name: "Elsewhere", position: 0 },
    });

    const res = await run(moveStageAction, { stageId: otherStage.id });
    expect(res.ok).toBe(false);

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Installed"]);

    await db.pipelineStage.delete({ where: { id: otherStage.id } });
    await db.pipeline.delete({ where: { id: otherPipe.id } });
    await db.company.delete({ where: { id: other.id } });
  });

  it("rejects a config with no stage", () => {
    expect(moveStageAction.parseConfig({}).ok).toBe(false);
  });
});

describe("set_project_status", () => {
  it("sets the status on the deal's project", async () => {
    await db.project.create({
      data: {
        companyId,
        vertical: "solar",
        leadId,
        projectNumber: `P-${Date.now()}`,
        status: "in_production",
      },
    });
    const res = await run(setProjectStatusAction, { status: "qc" });
    expect(res.ok).toBe(true);
    const project = await db.project.findFirst({ where: { leadId } });
    expect(project?.status).toBe("qc");
  });

  it("fails loudly when the deal has no project", async () => {
    const res = await run(setProjectStatusAction, { status: "qc" });
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(/no project/i);
  });

  it("rejects a status outside the enum", () => {
    expect(setProjectStatusAction.parseConfig({ status: "banana" }).ok).toBe(false);
  });
});
