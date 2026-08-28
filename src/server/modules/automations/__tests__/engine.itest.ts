import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runAutomations } from "../engine";

/**
 * The engine against a real database.
 *
 * Note what the tests DO NOT do: wrap anything in runInVertical. The engine
 * establishes the workspace itself from the rule it is running, which is what
 * lets the same code serve a server action, a cron with no session, and a test.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let pipelineId: string;
const stages: Record<string, string> = {};

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Engine Co", slug: `eng-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of ["Installed", "Inspection", "PTO"].entries()) {
    const s = await db.pipelineStage.create({ data: { pipelineId, key: `s${i}`, name, position: i } });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.notification.deleteMany({ where: { companyId } });
  await db.notificationRule.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

let leadId: string;
beforeEach(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId,
      stageId: stages["Installed"],
      firstName: "A",
      lastName: "B",
    },
  });
  leadId = lead.id;
});

async function rule(over: Record<string, unknown> = {}) {
  return db.automationRule.create({
    data: {
      companyId,
      vertical: "solar",
      name: "R",
      trigger: "stage_entered",
      conditions: { stageId: stages["Installed"] },
      actions: [{ type: "move_stage", stageId: stages["Inspection"] }],
      ...over,
    },
  });
}

const fire = (over: Record<string, unknown> = {}) =>
  runAutomations({
    companyId,
    vertical: "solar",
    trigger: "stage_entered",
    leadId,
    payload: { stageId: stages["Installed"] },
    depth: 0,
    ...over,
  });

describe("runAutomations", () => {
  it("runs a matching rule and records a successful run", async () => {
    const r = await rule();
    await fire();

    const lead = await db.lead.findUnique({ where: { id: leadId } });
    expect(lead?.stageId).toBe(stages["Inspection"]);

    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("succeeded");
    expect(run?.finishedAt).not.toBeNull();
    expect(run?.steps).toEqual([{ type: "move_stage", ok: true, detail: "Moved to Inspection." }]);
  });

  it("ignores an inactive rule", async () => {
    await rule({ active: false });
    await fire();
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Installed"]);
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });

  it("ignores a rule whose conditions do not match", async () => {
    await rule({ conditions: { stageId: stages["PTO"] } });
    await fire();
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });

  it("runs a once-rule only once per deal", async () => {
    const r = await rule();
    await fire();
    await db.lead.update({ where: { id: leadId }, data: { stageId: stages["Installed"] } });
    await fire();
    expect(await db.automationRun.count({ where: { ruleId: r.id, status: "succeeded" } })).toBe(1);
  });

  it("runs a repeatable rule every time", async () => {
    const r = await rule({ once: false });
    await fire();
    await db.lead.update({ where: { id: leadId }, data: { stageId: stages["Installed"] } });
    await fire();
    expect(await db.automationRun.count({ where: { ruleId: r.id, status: "succeeded" } })).toBe(2);
  });

  it("stops at the first failing action and does not run later ones", async () => {
    const r = await rule({
      actions: [
        { type: "set_project_status", status: "qc" }, // no project on this deal -> fails
        { type: "move_stage", stageId: stages["Inspection"] },
      ],
    });
    await fire();

    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("failed");
    expect(run?.error).toMatch(/no project/i);
    expect((run?.steps as unknown[]).length).toBe(1);

    // The action after the failure never ran.
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Installed"]);
  });

  it("refuses to run past the depth limit", async () => {
    const r = await rule();
    await fire({ depth: 3 });
    const run = await db.automationRun.findFirst({ where: { ruleId: r.id } });
    expect(run?.status).toBe("skipped");
    expect(run?.error).toBe("loop guard");
    // …and the deal did not move.
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Installed"]);
  });

  it("never throws, whatever the rule says", async () => {
    await rule({ actions: [{ type: "not_a_real_action" }] });
    await expect(fire()).resolves.toBeUndefined();
    const run = await db.automationRun.findFirst({ where: { companyId } });
    expect(run?.status).toBe("failed");
  });

  it("does not fire a roofing rule on a solar deal", async () => {
    await rule({ vertical: "roofing" });
    await fire();
    expect(await db.automationRun.count({ where: { companyId } })).toBe(0);
  });

  it("chains: a rule that moves a stage sets off the rule waiting there", async () => {
    await rule({ name: "first" });
    await db.automationRule.create({
      data: {
        companyId,
        vertical: "solar",
        name: "second",
        trigger: "stage_entered",
        conditions: { stageId: stages["Inspection"] },
        actions: [{ type: "move_stage", stageId: stages["PTO"] }],
      },
    });

    await fire();

    // Installed -> Inspection (first rule) -> PTO (second rule, set off by the
    // first). This chaining is the whole reason actions re-enter the engine.
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["PTO"]);
    expect(await db.automationRun.count({ where: { companyId, status: "succeeded" } })).toBe(2);
  });
});
