import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { NEW_AGENT_VALUES, type AgentFormValues } from "@/lib/agent-labels";
import { emptyDetail, readDetail } from "../detail";
import type { ChangeRecord } from "../types";

/**
 * Every Agents action is a public endpoint. `agentCan` and `can()` are NOT
 * mocked: the refusals below are the real permission code refusing real users.
 * Only the session (who is calling) and after() (run now's background work)
 * are stood in for.
 *
 * Also covers main's two solar stage rules (Contract Signed and M1 Funding —
 * user decision 2026-09-15): resolveAgentRunAction re-checks every held change
 * with stageMoveError, using the APPROVING person's own authority, not the
 * agent's — so an admin may carry a solar deal past M1 Funding with nothing
 * certified, a manager holding Agents access may not, and nobody may cross
 * Contract Signed without the evidence on file.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

type Current = {
  userId: string;
  companyId: string;
  role: Role;
  permissions: Record<string, unknown>;
  verticals: ("roofing" | "solar")[];
  fullName: string;
};
let current: Current;
const pending = vi.hoisted(() => [] as Promise<unknown>[]);

vi.mock("@/server/auth/session", () => ({ requireUser: async () => current, getSessionUser: async () => current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    pending.push(Promise.resolve().then(fn));
  },
}));

const actions = await import("../actions");
const flush = () => Promise.all(pending.splice(0));

const SWITCH = { "Agent:read": true, "Agent:run": true, "Agent:approve": true };
const PEOPLE: Record<string, { role: Role; permissions: Record<string, boolean>; name: string }> = {
  owner: { role: "super_admin", permissions: {}, name: "Olive Owner" },
  admin: { role: "admin", permissions: {}, name: "Ada Admin" },
  coordinator: { role: "manager", permissions: SWITCH, name: "Cora Coordinator" },
  salesManager: { role: "manager", permissions: {}, name: "Sam Manager" },
  accounting: { role: "accounting", permissions: {}, name: "Acc Ounting" },
  rep: { role: "sales_rep", permissions: SWITCH, name: "Rex Rep" },
};

let companyId = "";
let pipelineId = "";
let leadId = "";
let helloId = "";
let pollerId = "";
let heldRunId = "";
const ids: Record<string, string> = {};
const stage: Record<string, string> = {};

// Solar fixtures for main's stage rules: a Contract Signed stage (found by
// milestone) and an M1 Funding stage (found by key/name — see
// payroll/gate.ts findGateStage), same pattern as apply-changes.itest.ts.
let solarPipelineId = "";
let solarFundingLeadId = "";
let solarContractLeadId = "";
const solarStage: Record<string, string> = {};

const as = (who: keyof typeof PEOPLE) => {
  const p = PEOPLE[who];
  current = { userId: ids[who], companyId, role: p.role, permissions: { ...p.permissions }, verticals: ["roofing", "solar"], fullName: p.name };
};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Actions Co", slug: `agent-actions-${process.pid}-${Date.now()}` } })).id;
  for (const [key, p] of Object.entries(PEOPLE)) {
    const [firstName, lastName] = p.name.split(" ");
    ids[key] = (
      await db.user.create({
        data: { companyId, email: `${key}-${process.pid}@agent-actions.test`, firstName, lastName, role: p.role, status: "active", passwordHash: "x", permissions: p.permissions, verticals: ["roofing", "solar"] },
      })
    ).id;
  }
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  for (const [position, key] of ["from", "side", "main", "other"].entries()) {
    stage[key] = (
      await db.pipelineStage.create({ data: { pipelineId, key, name: key[0].toUpperCase() + key.slice(1), position, isActionRequired: key === "side" } })
    ).id;
  }
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
  helloId = (await db.agent.create({ data: { companyId, name: "Hello Agent", handlerKey: "system.hello", department: "operations" } })).id;
  pollerId = (await db.agent.create({ data: { companyId, name: "NTP Poller", handlerKey: "system.hello", department: "permit", vertical: "roofing" } })).id;

  // solar_signed sits at position 1 and carries the Contract Signed
  // milestone; m1_funding sits at position 2 and matches the M1 Funding
  // key/name pattern. A deal starting AT solar_signed is already past
  // Contract Signed, so a move on to m1_funding exercises the funding rule
  // alone. A deal starting at solar_start (position 0) has not earned
  // Contract Signed yet, so a move onto solar_signed exercises that rule alone.
  solarPipelineId = (await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } })).id;
  solarStage.start = (await db.pipelineStage.create({ data: { pipelineId: solarPipelineId, key: "solar_start", name: "Solar Start", position: 0 } })).id;
  solarStage.signed = (
    await db.pipelineStage.create({ data: { pipelineId: solarPipelineId, key: "solar_signed", name: "Solar Signed", position: 1, milestone: "contract_signed" } })
  ).id;
  solarStage.funding = (
    await db.pipelineStage.create({ data: { pipelineId: solarPipelineId, key: "m1_funding", name: "M1 Funding", position: 2 } })
  ).id;

  // Assigned to the coordinator so leadAccessible passes for a manager
  // holding Agents access — the M1 Funding test is about the FUNDING rule,
  // not row-scope.
  solarFundingLeadId = (
    await db.lead.create({
      data: { companyId, vertical: "solar", pipelineId: solarPipelineId, stageId: solarStage.signed, firstName: "Sam", lastName: "Solar", address: "9 Sun Way", assignedRepId: ids.coordinator },
    })
  ).id;
  solarContractLeadId = (
    await db.lead.create({ data: { companyId, vertical: "solar", pipelineId: solarPipelineId, stageId: solarStage.start, firstName: "Cara", lastName: "Contract", address: "3 Signed Rd" } })
  ).id;
});

beforeEach(async () => {
  pending.splice(0);
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { leadId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.update({ where: { id: leadId }, data: { stageId: stage.from } });
  const held: ChangeRecord = {
    type: "move_stage",
    leadId,
    toStageKey: "main",
    reason: "Portal shows NTP approved",
    dealLabel: "Maria Lopez · 12 Elm St",
    fromStage: { id: stage.from, key: "from", name: "From" },
    toStage: { id: stage.main, key: "main", name: "Main", position: 2, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
    outcome: "held",
    note: "Held: this agent is gated and Main is not an Action Required stage.",
  };
  heldRunId = (
    await db.agentRun.create({
      data: {
        companyId,
        agentId: pollerId,
        vertical: "roofing",
        trigger: "scheduled",
        status: "needs_human",
        summary: "NTP approved in the portal",
        detail: { ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }), changes: [held] } as unknown as Prisma.InputJsonValue,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.agentRun.deleteMany({ where: { companyId } });
  await db.agent.deleteMany({ where: { companyId } });
  await db.notification.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { lead: { companyId } } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
  await db.pipelineStage.deleteMany({ where: { pipelineId: { in: [pipelineId, solarPipelineId] } } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

describe("who may do what", () => {
  it.each([
    ["salesManager", "run"],
    ["salesManager", "resolve"],
    ["accounting", "run"],
    ["accounting", "resolve"],
    ["rep", "run"],
  ] as const)("%s cannot %s", async (who, what) => {
    as(who);
    const res =
      what === "run"
        ? await actions.runAgentNowAction(helloId, { confirmDisabled: true })
        : await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "x" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/permission/);
  });

  it.each(["coordinator", "salesManager", "accounting"] as const)("%s cannot create, edit or enable an agent, even with a hand-written override", async (who) => {
    as(who);
    current.permissions = { ...current.permissions, "Agent:create": true, "Agent:update": true };
    expect((await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Nope" })).ok).toBe(false);
    expect((await actions.updateAgentAction(helloId, { ...NEW_AGENT_VALUES, name: "Hello Agent" })).ok).toBe(false);
    expect((await actions.setAgentEnabledAction(helloId, true)).ok).toBe(false);
    expect(await db.agent.count({ where: { companyId, name: "Nope" } })).toBe(0);
  });
});

describe("creating and editing", () => {
  it("lets an admin create an agent, with its next run set from the schedule", async () => {
    as("admin");
    expect((await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Poller", enabled: true, schedule: "*/15 * * * *" })).ok).toBe(true);
    const row = await db.agent.findFirstOrThrow({ where: { companyId, name: "Poller" } });
    expect(row).toMatchObject({ enabled: true, schedule: "*/15 * * * *", updatedById: ids.admin });
    expect(row.nextRunAt!.getTime()).toBeGreaterThan(Date.now());
  });

  it("refuses an unknown handler, a secret in config, and a name already taken", async () => {
    as("admin");
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "X", handlerKey: "bank.ntp_poll" })).toMatchObject({ ok: false });
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Y", config: '{"apiKey":"sk-live"}' })).toMatchObject({ ok: false });
    expect(await actions.createAgentAction({ ...NEW_AGENT_VALUES, name: "Hello Agent" })).toEqual({ ok: false, error: "An agent with that name already exists." });
  });

  it("refuses to enable an agent whose handler is not deployed", async () => {
    as("admin");
    const broken = await db.agent.create({ data: { companyId, name: "Broken", handlerKey: "bank.ntp_poll", department: "permit" } });
    expect(await actions.setAgentEnabledAction(broken.id, true)).toMatchObject({ ok: false });
    expect((await db.agent.findUniqueOrThrow({ where: { id: broken.id } })).enabled).toBe(false);
  });
});

describe("runAgentNowAction", () => {
  it("asks before running a disabled agent, then runs it once per workspace", async () => {
    as("admin");
    expect(await actions.runAgentNowAction(helloId)).toMatchObject({ ok: false, needsConfirm: true });
    expect(await db.agentRun.count({ where: { agentId: helloId } })).toBe(0);

    expect((await actions.runAgentNowAction(helloId, { confirmDisabled: true })).ok).toBe(true);
    await flush();
    const runs = await db.agentRun.findMany({ where: { agentId: helloId } });
    expect(runs.map((r) => [r.vertical, r.status, r.summary, r.trigger, r.triggeredById]).sort()).toEqual([
      ["roofing", "success", "Said hello", "manual", ids.admin],
      ["solar", "success", "Said hello", "manual", ids.admin],
    ]);
  });

  it("lets a manager with Agents access run it", async () => {
    as("coordinator");
    expect((await actions.runAgentNowAction(helloId, { confirmDisabled: true })).ok).toBe(true);
    await flush();
    expect(await db.agentRun.count({ where: { agentId: helloId, status: "success" } })).toBe(2);
  });

  it("refuses while a run is already in flight", async () => {
    as("admin");
    // Defensive: this insert would trip the partial in-flight unique index if
    // an earlier test left Hello with a queued or running roofing row —
    // beforeEach already wipes every AgentRun for this company, but Hello's
    // runs are cleared explicitly too, since this is the one test that writes
    // a running row directly rather than through the action.
    await db.agentRun.deleteMany({ where: { agentId: helloId } });
    await db.agentRun.create({ data: { companyId, agentId: helloId, vertical: "roofing", trigger: "manual", status: "running", startedAt: new Date() } });
    expect(await actions.runAgentNowAction(helloId, { confirmDisabled: true })).toMatchObject({ ok: false });
  });

  it("writes a failed run for a handler that is not deployed", async () => {
    as("admin");
    const broken = await db.agent.create({ data: { companyId, name: "Broken Run", handlerKey: "bank.ntp_poll", department: "permit", vertical: "roofing", enabled: true } });
    expect(await actions.runAgentNowAction(broken.id)).toEqual({
      ok: false,
      error: 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.',
    });
    expect(await db.agentRun.findFirst({ where: { agentId: broken.id } })).toMatchObject({ status: "failed", trigger: "manual" });
  });
});

describe("resolveAgentRunAction", () => {
  it("applies a held change as the person who approved it", async () => {
    as("admin");
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" })).toEqual({ ok: true, failed: 0 });
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.main);
    expect(await db.leadStageEvent.findFirst({ where: { leadId, exitedAt: null } })).toMatchObject({ stageName: "Main", movedById: ids.admin, via: null });
    const run = await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } });
    expect(run).toMatchObject({ status: "needs_human", resolution: "applied", resolvedById: ids.admin });
    expect(readDetail(run.detail).resolution?.changes[0]).toMatchObject({ outcome: "applied" });
  });

  it("refuses when the deal has moved since the agent looked", async () => {
    as("admin");
    await db.lead.update({ where: { id: leadId }, data: { stageId: stage.other } });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" })).toEqual({
      ok: false,
      error: "Maria Lopez · 12 Elm St has moved since the agent looked (now in Other). Close this run instead.",
    });
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } })).resolvedAt).toBeNull();
  });

  it("closes without applying — only with a note, and only once", async () => {
    as("coordinator");
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed" })).toMatchObject({ ok: false });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "Bank fixed it by phone" })).toEqual({ ok: true, failed: 0 });
    expect(await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } })).toMatchObject({
      resolution: "closed",
      resolutionNote: "Bank fixed it by phone",
      resolvedById: ids.coordinator,
    });
    expect(await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "closed", note: "again" })).toEqual({
      ok: false,
      error: "This run has already been resolved.",
    });
  });

  it("does not let a manager with Agents access apply a change to a deal outside their own team", async () => {
    as("coordinator");
    const res = await actions.resolveAgentRunAction({ runId: heldRunId, resolution: "applied" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/can't open Maria Lopez · 12 Elm St/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.from);
  });
});

describe("resolveAgentRunAction — main's stage rules (Contract Signed and M1 Funding)", () => {
  let fundingRunId = "";
  let contractRunId = "";

  beforeEach(async () => {
    await db.lead.update({ where: { id: solarFundingLeadId }, data: { stageId: solarStage.signed } });
    await db.lead.update({ where: { id: solarContractLeadId }, data: { stageId: solarStage.start } });
    await db.leadStageEvent.deleteMany({ where: { leadId: { in: [solarFundingLeadId, solarContractLeadId] } } });

    const fundingChange: ChangeRecord = {
      type: "move_stage",
      leadId: solarFundingLeadId,
      toStageKey: "m1_funding",
      reason: "Install marked complete in the portal",
      dealLabel: "Sam Solar · 9 Sun Way",
      fromStage: { id: solarStage.signed, key: "solar_signed", name: "Solar Signed" },
      toStage: { id: solarStage.funding, key: "m1_funding", name: "M1 Funding", position: 2, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
      outcome: "held",
      note: "Held: this agent is gated and M1 Funding is not an Action Required stage.",
    };
    fundingRunId = (
      await db.agentRun.create({
        data: {
          companyId,
          agentId: helloId,
          vertical: "solar",
          trigger: "scheduled",
          status: "needs_human",
          summary: "Install marked complete",
          detail: { ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }), changes: [fundingChange] } as unknown as Prisma.InputJsonValue,
        },
      })
    ).id;

    const contractChange: ChangeRecord = {
      type: "move_stage",
      leadId: solarContractLeadId,
      toStageKey: "solar_signed",
      reason: "Rep marked the deal signed",
      dealLabel: "Cara Contract · 3 Signed Rd",
      fromStage: { id: solarStage.start, key: "solar_start", name: "Solar Start" },
      toStage: { id: solarStage.signed, key: "solar_signed", name: "Solar Signed", position: 1, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
      outcome: "held",
      note: "Held: this agent is gated and Solar Signed is not an Action Required stage.",
    };
    contractRunId = (
      await db.agentRun.create({
        data: {
          companyId,
          agentId: helloId,
          vertical: "solar",
          trigger: "scheduled",
          status: "needs_human",
          summary: "Rep marked signed",
          detail: { ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }), changes: [contractChange] } as unknown as Prisma.InputJsonValue,
        },
      })
    ).id;
  });

  it("lets an admin apply a held change that carries a solar deal past M1 Funding with nothing certified", async () => {
    as("admin");
    expect(await actions.resolveAgentRunAction({ runId: fundingRunId, resolution: "applied" })).toEqual({ ok: true, failed: 0 });
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarFundingLeadId } })).stageId).toBe(solarStage.funding);
  });

  it("refuses a manager holding Agents access, even on their own team's deal, past M1 Funding with nothing certified", async () => {
    as("coordinator");
    const res = await actions.resolveAgentRunAction({ runId: fundingRunId, resolution: "applied" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/M1 Funding/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarFundingLeadId } })).stageId).toBe(solarStage.signed);
  });

  it("refuses anyone, admin included, a held change past Contract Signed without evidence", async () => {
    as("admin");
    const res = await actions.resolveAgentRunAction({ runId: contractRunId, resolution: "applied" });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/Contract Signed needs both/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: solarContractLeadId } })).stageId).toBe(solarStage.start);
  });
});

/** A payload the form would never build: the actions take a TYPE, which is gone by the time one arrives. */
const malformed = (over: Record<string, unknown>) => ({ ...NEW_AGENT_VALUES, ...over }) as unknown as AgentFormValues;

describe("input the form never sends", () => {
  it("refuses a config payload in a sentence, rather than throwing a TypeError out of the action", async () => {
    as("admin");
    const refusal = { ok: false, error: "That form could not be read. Reload and try again." };
    expect(await actions.createAgentAction(malformed({ name: undefined }))).toEqual(refusal);
    expect(await actions.createAgentAction(malformed({ name: 42 }))).toEqual(refusal);
    expect(await actions.createAgentAction(malformed({ config: {} }))).toEqual(refusal);
    expect(await actions.createAgentAction(null as unknown as AgentFormValues)).toEqual(refusal);
    expect(await actions.updateAgentAction(helloId, malformed({ description: 7 }))).toEqual(refusal);
    expect(await actions.updateAgentAction(helloId, malformed({ schedule: null }))).toEqual(refusal);
  });

  it("refuses a resolve payload carrying a key the action does not define", async () => {
    as("admin");
    const extra = { runId: heldRunId, resolution: "closed", note: "x", applyAnyway: true } as unknown as Parameters<
      typeof actions.resolveAgentRunAction
    >[0];
    expect(await actions.resolveAgentRunAction(extra)).toEqual({ ok: false, error: "Invalid request." });
    expect((await db.agentRun.findUniqueOrThrow({ where: { id: heldRunId } })).resolvedAt).toBeNull();
  });
});

describe("updateAgentAction and the header switch", () => {
  it("ignores `enabled` in the form, in both directions", async () => {
    as("admin");
    const agent = await db.agent.create({ data: { companyId, name: "Switch Me", handlerKey: "system.hello", department: "operations", enabled: false } });

    expect((await actions.updateAgentAction(agent.id, { ...NEW_AGENT_VALUES, name: "Switch Me", enabled: true })).ok).toBe(true);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).enabled).toBe(false);

    await db.agent.update({ where: { id: agent.id }, data: { enabled: true } });
    expect((await actions.updateAgentAction(agent.id, { ...NEW_AGENT_VALUES, name: "Switch Me", enabled: false })).ok).toBe(true);
    expect((await db.agent.findUniqueOrThrow({ where: { id: agent.id } })).enabled).toBe(true);
  });
});

describe("runAgentNowAction — an agent whose handler is not deployed", () => {
  let brokenId = "";
  const message = 'No handler is registered for "bank.ntp_poll". Deploy the handler or disable this agent.';

  beforeAll(async () => {
    brokenId = (
      await db.agent.create({ data: { companyId, name: "Quiet Broken", handlerKey: "bank.ntp_poll", department: "permit", vertical: "roofing", enabled: true } })
    ).id;
  });

  it("answers every click, but writes one failed run and one alert rather than one per click", async () => {
    as("admin");
    for (let click = 0; click < 3; click++) {
      expect(await actions.runAgentNowAction(brokenId)).toEqual({ ok: false, error: message });
    }
    expect(await db.agentRun.count({ where: { agentId: brokenId } })).toBe(1);
  });

  it("says a run is already in progress instead of writing another missing-handler run", async () => {
    as("admin");
    await db.agentRun.create({ data: { companyId, agentId: brokenId, vertical: "roofing", trigger: "manual", status: "running", startedAt: new Date() } });
    expect(await actions.runAgentNowAction(brokenId)).toEqual({
      ok: false,
      error: "This agent already has a run in progress. Wait for it to finish.",
    });
    expect(await db.agentRun.count({ where: { agentId: brokenId, status: "failed" } })).toBe(0);
  });
});

describe("resolveAgentRunAction — a change that cannot be applied", () => {
  it("records the second of two changes on one deal as discarded, and says so on the run itself", async () => {
    as("admin");
    const base: ChangeRecord = {
      type: "move_stage",
      leadId,
      toStageKey: "main",
      reason: "Portal shows NTP approved",
      dealLabel: "Maria Lopez · 12 Elm St",
      fromStage: { id: stage.from, key: "from", name: "From" },
      toStage: { id: stage.main, key: "main", name: "Main", position: 2, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
      outcome: "held",
      note: "Held: this agent is gated and Main is not an Action Required stage.",
    };
    // Both changes pass the read-only re-check — the deal is still in From for
    // each of them — and then the first move makes the second one impossible.
    const runId = (
      await db.agentRun.create({
        data: {
          companyId,
          agentId: pollerId,
          vertical: "roofing",
          trigger: "scheduled",
          status: "needs_human",
          summary: "NTP approved in the portal",
          detail: {
            ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }),
            changes: [base, { ...base, reason: "Portal still shows NTP approved" }],
          } as unknown as Prisma.InputJsonValue,
        },
      })
    ).id;

    expect(await actions.resolveAgentRunAction({ runId, resolution: "applied", note: "Approved on the phone" })).toEqual({ ok: true, failed: 1 });

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    const changes = readDetail(run.detail).resolution?.changes ?? [];
    expect(changes.map((c) => c.outcome)).toEqual(["applied", "discarded"]);
    expect(changes[1].note).toBe("Not applied: This deal has moved since the agent looked at it; nothing was changed.");
    // The list shows the resolution and this note, never the changes: without
    // the count it would read as a clean apply.
    expect(run.resolutionNote).toBe("Approved on the phone — Applied 1 of 2 changes.");
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.main);
  });
});
