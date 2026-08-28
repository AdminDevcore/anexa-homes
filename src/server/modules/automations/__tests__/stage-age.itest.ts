import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runUnscoped } from "@/server/vertical/context";
import { runStageAgeAutomations } from "../stage-age";

/**
 * The one trigger with nobody behind it.
 *
 * `now` is injected rather than slept for, and the sweep is called through
 * runUnscoped exactly as the cron route calls it — finding the work reads
 * across workspaces, acting on it is scoped again inside the engine.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const DAY = 24 * 60 * 60 * 1000;
const NOW = Date.UTC(2026, 7, 27);

let companyId: string;
let pipelineId: string;
const stages: Record<string, string> = {};

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Age Co", slug: `age-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const p = await db.pipeline.create({ data: { companyId, name: "P", vertical: "solar" } });
  pipelineId = p.id;
  for (const [i, name] of ["Permit Submitted", "Escalated"].entries()) {
    const s = await db.pipelineStage.create({ data: { pipelineId, key: `s${i}`, name, position: i } });
    stages[name] = s.id;
  }
});

afterAll(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.delete({ where: { id: pipelineId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.automationRun.deleteMany({ where: { companyId } });
  await db.automationRule.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.lead.deleteMany({ where: { companyId } });
});

/** A deal parked in Permit Submitted for `daysAgo` days. */
async function stuckDeal(daysAgo: number, over: Record<string, unknown> = {}) {
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId,
      stageId: stages["Permit Submitted"],
      firstName: "Stuck",
      lastName: "Deal",
      status: "open",
      ...over,
    },
  });
  await db.leadStageEvent.create({
    data: {
      leadId: lead.id,
      stageId: stages["Permit Submitted"],
      stageName: "Permit Submitted",
      enteredAt: new Date(NOW - daysAgo * DAY),
      exitedAt: null,
    },
  });
  return lead.id;
}

async function ageRule(over: Record<string, unknown> = {}) {
  return db.automationRule.create({
    data: {
      companyId,
      vertical: "solar",
      name: "Chase the permit",
      trigger: "stage_age_exceeded",
      conditions: { stageId: stages["Permit Submitted"], days: 14 },
      actions: [{ type: "move_stage", stageId: stages["Escalated"] }],
      ...over,
    },
  });
}

const sweep = () => runUnscoped("test", () => runStageAgeAutomations(NOW));

describe("runStageAgeAutomations", () => {
  it("acts on a deal past the threshold", async () => {
    await ageRule();
    const leadId = await stuckDeal(20);

    expect(await sweep()).toBe(1);
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(stages["Escalated"]);
  });

  it("leaves a deal that has not waited long enough", async () => {
    await ageRule();
    const leadId = await stuckDeal(3);

    expect(await sweep()).toBe(0);
    expect((await db.lead.findUnique({ where: { id: leadId } }))?.stageId).toBe(
      stages["Permit Submitted"]
    );
  });

  it("does not chase the same deal again tomorrow", async () => {
    await ageRule();
    await stuckDeal(20);

    await sweep();
    // The move closed the old span and opened one in Escalated, so the deal is
    // no longer stuck — but even if it were, the `once` guard stops a re-run.
    await sweep();
    expect(await db.automationRun.count({ where: { companyId, status: "succeeded" } })).toBe(1);
  });

  it("ignores a rule with no threshold rather than sweeping every deal", async () => {
    await ageRule({ conditions: { stageId: stages["Permit Submitted"] } });
    await stuckDeal(400);

    expect(await sweep()).toBe(0);
  });

  it("ignores a deal that is already won or lost", async () => {
    await ageRule();
    await stuckDeal(20, { status: "lost" });

    expect(await sweep()).toBe(0);
  });
});
