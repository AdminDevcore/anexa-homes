import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import { encryptField } from "@/server/lib/crypto";
import { moveDeal, resolveChanges } from "../apply-changes";
import { buildDeps } from "../deps";
import { resolveSecretRef } from "../secrets";

/**
 * What a run can see and do to deals, against a real database with isolation
 * on: a roofing run cannot find a solar deal, a stage key resolves inside the
 * deal's own pipeline, and a move lands exactly the rows a person's move does.
 *
 * Also: agents obey main's two solar stage rules (Contract Signed and M1
 * Funding — user decision 2026-09-15). `resolveChanges` fills a refusal for
 * either rule a move would cross; a roofing deal is never refused by either.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let otherCompanyId = "";
let roofingPipe = "";
let solarPipe = "";
let roofingLead = "";
let solarLead = "";
let solarFundingLead = "";
let userId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Apply Co", slug: `apply-${process.pid}-${Date.now()}` } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "Other Apply Co", slug: `apply-other-${process.pid}-${Date.now()}` } })).id;
  userId = (
    await db.user.create({ data: { companyId, email: `ada-${process.pid}@apply.test`, firstName: "Ada", lastName: "Admin", role: "admin", status: "active", passwordHash: "x" } })
  ).id;

  roofingPipe = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  stage.submitted = (await db.pipelineStage.create({ data: { pipelineId: roofingPipe, key: "submitted", name: "Submitted", position: 0 } })).id;
  stage.action = (
    await db.pipelineStage.create({
      data: { pipelineId: roofingPipe, key: "action_required", name: "Action Required", position: 1, isActionRequired: true, defaultBlocker: "lender", stageType: "externally_blocked" },
    })
  ).id;
  stage.approved = (await db.pipelineStage.create({ data: { pipelineId: roofingPipe, key: "approved", name: "Approved", position: 2 } })).id;

  solarPipe = (await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } })).id;
  const solarStage = await db.pipelineStage.create({ data: { pipelineId: solarPipe, key: "action_required", name: "Solar Action", position: 0 } });
  // Contract Signed (found by milestone, not key/name) and M1 Funding (found by
  // key/name pattern — see payroll/gate.ts findGateStage) so the two solar
  // stage rules have somewhere to find their gate.
  const contractStage = await db.pipelineStage.create({
    data: { pipelineId: solarPipe, key: "contract_signed_stage", name: "Contract Signed", position: 1, milestone: "contract_signed" },
  });
  await db.pipelineStage.create({
    data: { pipelineId: solarPipe, key: "m1_funding", name: "M1 Funding", position: 2 },
  });

  roofingLead = (
    await db.lead.create({
      data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Maria", lastName: "Lopez", address: "12 Elm St", city: "Dallas" },
    })
  ).id;
  solarLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: solarStage.id, firstName: "Sol", lastName: "Customer" } })
  ).id;
  // Already sitting AT Contract Signed, so a move on to M1 Funding tests the
  // funding rule alone — it is not, itself, crossing the Contract Signed line.
  solarFundingLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: contractStage.id, firstName: "Fund", lastName: "Test" } })
  ).id;
});

afterAll(async () => {
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.solarMilestone.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.solarLender.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [roofingPipe, solarPipe] } } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await db.$disconnect();
});

const change = (leadId: string, toStageKey: string) => ({ type: "move_stage" as const, leadId, toStageKey, reason: "portal says so" });

describe("resolveChanges", () => {
  it("resolves a change against the deal's own pipeline, in the run's workspace", async () => {
    const [ok, wrongWorkspace, noStage] = await runInVertical("roofing", () =>
      resolveChanges(companyId, [change(roofingLead, "action_required"), change(solarLead, "action_required"), change(roofingLead, "nope")])
    );
    expect(ok.lead).toEqual({ id: roofingLead, label: "Maria Lopez · 12 Elm St, Dallas" });
    expect(ok.fromStage).toMatchObject({ key: "submitted", name: "Submitted" });
    expect(ok.toStage).toMatchObject({ key: "action_required", isActionRequired: true, defaultBlocker: "lender" });
    expect(wrongWorkspace.lead).toBeNull();
    expect(noStage.toStage).toBeNull();
  });
});

describe("resolveChanges — Contract Signed and M1 Funding", () => {
  it("flags a solar deal headed past Contract Signed with no evidence", async () => {
    const [c] = await runInVertical("solar", () => resolveChanges(companyId, [change(solarLead, "contract_signed_stage")]));
    expect(c.contractRefusal).toMatch(/Contract Signed needs both/);
    expect(c.fundingRefusal).toBeNull();
  });

  it("flags a solar deal headed past M1 Funding until the rep's M1 milestone is paid", async () => {
    const [before] = await runInVertical("solar", () => resolveChanges(companyId, [change(solarFundingLead, "m1_funding")]));
    expect(before.fundingRefusal).toMatch(/M1 Funding/);
    expect(before.contractRefusal).toBeNull();

    await db.solarMilestone.create({
      data: { companyId, vertical: "solar", leadId: solarFundingLead, payee: "rep", sequence: 1, label: "M1", paidAt: new Date() },
    });

    const [after] = await runInVertical("solar", () => resolveChanges(companyId, [change(solarFundingLead, "m1_funding")]));
    expect(after.fundingRefusal).toBeNull();
  });

  it("never refuses a roofing deal", async () => {
    // Read-only: resolveChanges does not move anything, so this runs safely
    // ahead of the "moveDeal" tests below that do move roofingLead.
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "action_required")]));
    expect(c.contractRefusal).toBeNull();
    expect(c.fundingRefusal).toBeNull();
  });
});

describe("moveDeal", () => {
  it("moves a deal as an agent: entry fields, a timeline row via agent, an activity line", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "action_required")]));
    await runInVertical("roofing", () => moveDeal(companyId, roofingLead, c.toStage!, { kind: "agent", agentName: "NTP Poller" }));

    expect(await db.lead.findUniqueOrThrow({ where: { id: roofingLead } })).toMatchObject({
      stageId: stage.action,
      blockedBy: "lender",
      stageAlertLevel: 0,
    });
    expect(await db.leadStageEvent.findFirst({ where: { leadId: roofingLead, exitedAt: null } })).toMatchObject({
      stageName: "Action Required",
      via: "agent",
      movedById: null,
    });
    expect(await db.activityLog.findFirst({ where: { leadId: roofingLead }, orderBy: { createdAt: "desc" } })).toMatchObject({
      type: "stage_change",
      actorId: null,
      message: 'Agent "NTP Poller" moved the deal to Action Required',
    });
  });

  it("names the person when a person approved the change", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "approved")]));
    await runInVertical("roofing", () =>
      moveDeal(companyId, roofingLead, c.toStage!, { kind: "person", userId, fullName: "Ada Admin", agentName: "NTP Poller" })
    );
    expect(await db.leadStageEvent.findFirst({ where: { leadId: roofingLead, exitedAt: null } })).toMatchObject({
      stageName: "Approved",
      movedById: userId,
      via: null,
    });
    expect(await db.activityLog.findFirst({ where: { leadId: roofingLead }, orderBy: { createdAt: "desc" } })).toMatchObject({
      actorId: userId,
      message: 'Ada Admin moved the deal to Approved, approving agent "NTP Poller"',
    });
  });
});

describe("buildDeps", () => {
  it("reads deals in the run's workspace only", async () => {
    const deps = buildDeps(companyId);
    const inRoofing = await runInVertical("roofing", () => deps.deals.inStages(["submitted", "action_required", "approved"]));
    expect(inRoofing.map((d) => [d.id, d.stageKey])).toEqual([[roofingLead, "approved"]]);
    expect(await runInVertical("roofing", () => deps.deals.get(solarLead))).toBeNull();
  });
});

describe("resolveSecretRef", () => {
  it("reads AGENT_ env vars and this company's lender keys, and nothing else", async () => {
    process.env.AGENT_ITEST_TOKEN = "s3cret";
    expect(await resolveSecretRef(companyId, "env:AGENT_ITEST_TOKEN")).toBe("s3cret");
    expect(await resolveSecretRef(companyId, "env:DATABASE_URL")).toBeNull();

    const mine = await db.solarLender.create({ data: { companyId, name: "Itest Lender", apiKeyEncrypted: encryptField("lender-key") } });
    const theirs = await db.solarLender.create({ data: { companyId: otherCompanyId, name: "Other Lender", apiKeyEncrypted: encryptField("not-yours") } });
    expect(await runInVertical("solar", () => resolveSecretRef(companyId, `lender:${mine.id}`))).toBe("lender-key");
    expect(await runInVertical("solar", () => resolveSecretRef(companyId, `lender:${theirs.id}`))).toBeNull();
  });
});
