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
 *
 * And: a move is conditional on the stage the caller saw, and the write is
 * atomic — code review findings on c4dcdc6, fixed here.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId = "";
let otherCompanyId = "";
let roofingPipe = "";
let solarPipe = "";
let otherRoofingPipe = "";
let roofingLead = "";
let solarLead = "";
let solarFundingLead = "";
let solarSkipLead = "";
let otherRoofingLead = "";
let buildDepsLead = "";
let staleLead = "";
let atomicLead = "";
let stampLead = "";
let userId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Apply Co", slug: `apply-${process.pid}-${Date.now()}` } })).id;
  otherCompanyId = (await db.company.create({ data: { name: "Other Apply Co", slug: `apply-other-${process.pid}-${Date.now()}` } })).id;
  userId = (
    await db.user.create({
      data: { companyId, email: `ada-${process.pid}-${Date.now()}@apply.test`, firstName: "Ada", lastName: "Admin", role: "admin", status: "active", passwordHash: "x" },
    })
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
  const fundingStage = await db.pipelineStage.create({
    data: { pipelineId: solarPipe, key: "m1_funding", name: "M1 Funding", position: 2 },
  });

  // A SEPARATE company with a pipeline that uses the SAME stage key as ours —
  // "submitted" — so a companyId filter dropped from resolveChanges, or from
  // either deps.deals query, would still happen to match on the key alone.
  otherRoofingPipe = (await db.pipeline.create({ data: { companyId: otherCompanyId, name: "Other Roofing", vertical: "roofing" } })).id;
  const otherSubmitted = await db.pipelineStage.create({ data: { pipelineId: otherRoofingPipe, key: "submitted", name: "Submitted", position: 0 } });

  roofingLead = (
    await db.lead.create({
      data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Maria", lastName: "Lopez", address: "12 Elm St", city: "Dallas" },
    })
  ).id;
  // A real move flow logs entry into the starting stage too; back that in so
  // the first move below has a previous timeline row to close.
  await db.leadStageEvent.create({ data: { leadId: roofingLead, stageId: stage.submitted, stageName: "Submitted", position: 0 } });

  solarLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: solarStage.id, firstName: "Sol", lastName: "Customer" } })
  ).id;
  // Already sitting AT Contract Signed, so a move on to M1 Funding tests the
  // funding rule alone — it is not, itself, crossing the Contract Signed line.
  solarFundingLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: contractStage.id, firstName: "Fund", lastName: "Test" } })
  ).id;
  // Already sitting IN M1 Funding, with no milestone on file at all — the
  // dedicated fixture for the "already in target" skip test below. Kept
  // separate from solarFundingLead so that case's own milestone (paid partway
  // through its test) never touches this one.
  solarSkipLead = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipe, stageId: fundingStage.id, firstName: "Skip", lastName: "Test" } })
  ).id;
  otherRoofingLead = (
    await db.lead.create({
      data: { companyId: otherCompanyId, vertical: "roofing", pipelineId: otherRoofingPipe, stageId: otherSubmitted.id, firstName: "Not", lastName: "Ours" },
    })
  ).id;
  buildDepsLead = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Build", lastName: "Deps" } })
  ).id;
  staleLead = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Stale", lastName: "Move" } })
  ).id;
  atomicLead = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Atomic", lastName: "Move" } })
  ).id;
  stampLead = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId: roofingPipe, stageId: stage.submitted, firstName: "Stamp", lastName: "Move" } })
  ).id;
});

afterAll(async () => {
  delete process.env.AGENT_ITEST_TOKEN;
  await db.activityLog.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId: { in: [companyId, otherCompanyId] } } } });
  await db.solarMilestone.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.solarLender.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [roofingPipe, solarPipe, otherRoofingPipe] } } });
  await db.pipeline.deleteMany({ where: { companyId: { in: [companyId, otherCompanyId] } } });
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
    // resolveChanges only reads — it never moves a deal — so this holds
    // whatever stage roofingLead happens to be in when it runs.
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "action_required")]));
    expect(c.contractRefusal).toBeNull();
    expect(c.fundingRefusal).toBeNull();
  });

  it("skips both refusals when the deal is already in its target stage", async () => {
    // solarSkipLead sits IN M1 Funding with no milestone on file — without
    // the skip, fundingGateError would refuse this on its own merits (see
    // the M1 Funding case above, which is this same situation MINUS the
    // "already there" fact). With the skip, resolving a change that asks for
    // the stage the deal is already in never calls either rule.
    const [c] = await runInVertical("solar", () => resolveChanges(companyId, [change(solarSkipLead, "m1_funding")]));
    expect(c.contractRefusal).toBeNull();
    expect(c.fundingRefusal).toBeNull();
  });
});

describe("company isolation", () => {
  it("resolveChanges cannot find another company's deal, even with a matching stage key", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(otherRoofingLead, "submitted")]));
    expect(c.lead).toBeNull();
  });

  it("deps.deals.get and deps.deals.inStages cannot see another company's deal, even with a matching stage key", async () => {
    const deps = buildDeps(companyId);
    expect(await runInVertical("roofing", () => deps.deals.get(otherRoofingLead))).toBeNull();
    const inRoofing = await runInVertical("roofing", () => deps.deals.inStages(["submitted"]));
    expect(inRoofing.map((d) => d.id)).not.toContain(otherRoofingLead);
  });
});

describe("moveDeal", () => {
  it("moves a deal as an agent: entry fields, a timeline row via agent, an activity line, and closes the row it left", async () => {
    const previousEvent = await db.leadStageEvent.findFirstOrThrow({ where: { leadId: roofingLead, exitedAt: null } });

    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(roofingLead, "action_required")]));
    await runInVertical("roofing", () => moveDeal(companyId, roofingLead, c.fromStage!.id, c.toStage!, { kind: "agent", agentName: "NTP Poller" }));

    expect(await db.lead.findUniqueOrThrow({ where: { id: roofingLead } })).toMatchObject({
      stageId: stage.action,
      blockedBy: "lender",
      stageAlertLevel: 0,
    });
    expect(await db.leadStageEvent.findUnique({ where: { id: previousEvent.id } })).toMatchObject({
      exitedAt: expect.any(Date),
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
      moveDeal(companyId, roofingLead, c.fromStage!.id, c.toStage!, { kind: "person", userId, fullName: "Ada Admin", agentName: "NTP Poller" })
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

  it("stamps the activity row and the timeline row with the run's own workspace", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(stampLead, "action_required")]));
    await runInVertical("roofing", () => moveDeal(companyId, stampLead, c.fromStage!.id, c.toStage!, { kind: "agent", agentName: "NTP Poller" }));

    // ActivityLog is TAGGED: the isolation extension stamps `vertical` with
    // whatever workspace was active when the write happened, even through
    // the transaction's tx client.
    expect(await db.activityLog.findFirst({ where: { leadId: stampLead }, orderBy: { createdAt: "desc" } })).toMatchObject({
      vertical: "roofing",
    });
    // LeadStageEvent carries no vertical column of its own — it is reached
    // only through its parent Lead — so "the right workspace" here means the
    // row exists, open, against the deal that move actually ran against.
    expect(await db.leadStageEvent.findFirst({ where: { leadId: stampLead, exitedAt: null } })).toMatchObject({
      stageName: "Action Required",
    });
  });

  it("refuses a stale move: the deal moved since the agent looked, so nothing is written", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(staleLead, "action_required")]));

    // Somebody else moves the deal first, directly — a rep cancelling it, in
    // spirit, though any other move demonstrates the same race.
    await db.lead.update({ where: { id: staleLead }, data: { stageId: stage.approved } });

    await expect(
      runInVertical("roofing", () => moveDeal(companyId, staleLead, c.fromStage!.id, c.toStage!, { kind: "agent", agentName: "NTP Poller" }))
    ).rejects.toThrow("This deal has moved since the agent looked at it; nothing was changed.");

    expect(await db.lead.findUniqueOrThrow({ where: { id: staleLead } })).toMatchObject({ stageId: stage.approved });
    expect(await db.leadStageEvent.findFirst({ where: { leadId: staleLead, stageName: "Action Required" } })).toBeNull();
    expect(await db.activityLog.count({ where: { leadId: staleLead } })).toBe(0);
  });

  it("rolls back the whole move, atomically, if the activity write fails", async () => {
    const [c] = await runInVertical("roofing", () => resolveChanges(companyId, [change(atomicLead, "action_required")]));
    // An embedded NUL byte fails ONLY the activity write: Postgres text
    // columns reject 0x00, and the agent's name reaches nowhere else — the
    // "agent" form's timeline row carries `via: "agent"` and no name at all
    // (see moveDeal). This isolates the failure to the activity statement, so
    // a surviving timeline row here can only mean the transaction didn't
    // really cover recordStageEntry's write.
    await expect(
      runInVertical("roofing", () =>
        moveDeal(companyId, atomicLead, c.fromStage!.id, c.toStage!, { kind: "agent", agentName: "bad   name" })
      )
    ).rejects.toThrow();

    expect(await db.lead.findUniqueOrThrow({ where: { id: atomicLead } })).toMatchObject({ stageId: stage.submitted });
    expect(await db.leadStageEvent.findFirst({ where: { leadId: atomicLead, stageName: "Action Required" } })).toBeNull();
    expect(await db.activityLog.count({ where: { leadId: atomicLead } })).toBe(0);
  });
});

describe("buildDeps", () => {
  it("reads deals in the run's workspace and company only", async () => {
    // Self-contained: sets the state this test cares about directly, rather
    // than relying on the "moveDeal" tests above having already run.
    await db.lead.update({ where: { id: buildDepsLead }, data: { stageId: stage.approved, stageChangedAt: new Date() } });

    const deps = buildDeps(companyId);
    const inRoofing = await runInVertical("roofing", () => deps.deals.inStages(["submitted", "action_required", "approved"]));
    expect(inRoofing.map((d) => [d.id, d.stageKey])).toContainEqual([buildDepsLead, "approved"]);
    expect(inRoofing.map((d) => d.id)).not.toContain(otherRoofingLead);

    expect(await runInVertical("roofing", () => deps.deals.get(solarLead))).toBeNull();
    expect(await runInVertical("roofing", () => deps.deals.get(otherRoofingLead))).toBeNull();
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
