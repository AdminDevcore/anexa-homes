import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import type { NovaCtx, ToolResult } from "../types";

/**
 * Nova's write tools against real Postgres.
 *
 * The writes go through the portal's own server actions, which call
 * `requireUser()` — mocked here to answer as whoever the test is acting as, and
 * nothing else. `can()`, `listScope()` and the actions' own checks are real.
 * Every write is proposed first and asserted to have changed NOTHING until it
 * is confirmed.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

/** Who `requireUser()` answers with — always the same person as the Nova ctx. */
let current: Record<string, unknown> = {};
vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("@/server/auth/vertical", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/server/auth/vertical")>()),
  getActiveVertical: async () => "solar",
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const { runInVertical } = await import("@/server/vertical/context");
const { runNovaTool } = await import("../tools/run");
const { confirmPendingAction, cancelPendingAction } = await import("../pending");
const { getNovaActivity } = await import("../activity");

const TZ = "America/Chicago";

type Who = { id: string; role: Role; first: string; last: string };
let OLIVE: Who;
let ADA: Who;
let BEA: Who;

let companyId = "";
let danaId = "";
let lenaId = "";
let ritaId = "";
let stageAppt = "";
let stageSigned = "";

function as(who: Who): NovaCtx {
  const fullName = `${who.first} ${who.last}`;
  current = {
    userId: who.id,
    companyId,
    role: who.role,
    permissions: {},
    fullName,
    firstName: who.first,
    lastName: who.last,
    email: null,
    verticals: ["roofing", "solar"],
  };
  return {
    user: { userId: who.id, companyId, role: who.role, permissions: {}, fullName },
    conversationId: "itest-writes",
    timeZone: TZ,
    now: new Date(),
    page: null,
  };
}

const solar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);
const propose = (c: NovaCtx, tool: string, input: unknown) => solar(() => runNovaTool(c, tool, input));
const confirm = (c: NovaCtx, id: string) => solar(() => confirmPendingAction(c, id));
const cancel = (c: NovaCtx, id: string) => solar(() => cancelPendingAction(c, id));

function proposal(r: ToolResult) {
  if (!r.ok || !r.proposal) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r.proposal;
}
function refusal(r: ToolResult) {
  if (r.ok) throw new Error(`expected a refusal, got ${JSON.stringify(r)}`);
  return r;
}
const auditFor = (pendingActionId: string) =>
  db.novaAuditEvent.findMany({ where: { companyId, pendingActionId }, orderBy: { createdAt: "asc" } });

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  companyId = (
    await db.company.create({ data: { name: "Nova Writes Co", slug: `nova-writes-${stamp}`, timezone: TZ } })
  ).id;

  const user = async (first: string, last: string, role: Role): Promise<Who> => ({
    id: (
      await db.user.create({
        data: {
          companyId,
          email: `${first.toLowerCase()}-${stamp}@nova.test`,
          firstName: first,
          lastName: last,
          role,
          status: "active",
          passwordHash: "x",
          verticals: ["roofing", "solar"],
        },
      })
    ).id,
    role,
    first,
    last,
  });
  OLIVE = await user("Olive", "Owner", "super_admin");
  ADA = await user("Ada", "Rep", "sales_rep");
  BEA = await user("Bea", "Rep", "sales_rep");

  const solarPipe = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar", isDefault: true },
  });
  const stageNew = await db.pipelineStage.create({
    data: { pipelineId: solarPipe.id, key: "new_lead", name: "New Lead", position: 0 },
  });
  stageAppt = (
    await db.pipelineStage.create({
      data: { pipelineId: solarPipe.id, key: "appointment_set", name: "Appointment Set", position: 1 },
    })
  ).id;
  stageSigned = (
    await db.pipelineStage.create({
      data: { pipelineId: solarPipe.id, key: "contract_signed", name: "Contract Signed", position: 2, countsAsSold: true },
    })
  ).id;
  const roofPipe = await db.pipeline.create({
    data: { companyId, name: "Roofing", vertical: "roofing", isDefault: true },
  });
  const roofNew = await db.pipelineStage.create({
    data: { pipelineId: roofPipe.id, key: "new_lead", name: "New Lead", position: 0 },
  });

  const lead = async (data: Record<string, unknown>) =>
    (await db.lead.create({ data: { companyId, stageChangedAt: new Date(), ...data } as never })).id;
  const solarLead = (firstName: string, lastName: string, rep: Who) =>
    lead({ vertical: "solar", serviceType: "solar", pipelineId: solarPipe.id, stageId: stageNew.id, firstName, lastName, assignedRepId: rep.id });

  danaId = await solarLead("Dana", "Whitfield", ADA);
  lenaId = await solarLead("Lena", "Moss", ADA);
  await solarLead("Omar", "Castillo", BEA);
  ritaId = await lead({
    vertical: "roofing",
    pipelineId: roofPipe.id,
    stageId: roofNew.id,
    firstName: "Rita",
    lastName: "Roofing",
    assignedRepId: ADA.id,
  });

  // A required field in each workspace. Only Solar's may be asked for.
  await db.customFieldDef.create({
    data: { companyId, vertical: "solar", entity: "lead", key: "roof_type", label: "Roof Type", type: "select", options: ["Shingle", "Tile"], required: true },
  });
  await db.customFieldDef.create({
    data: { companyId, vertical: "roofing", entity: "lead", key: "damage_type", label: "Damage Type", type: "text", required: true },
  });
});

afterAll(async () => {
  await db.novaAuditEvent.deleteMany({ where: { companyId } });
  await db.novaPendingAction.deleteMany({ where: { companyId } });
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("proposing a write changes nothing", () => {
  it("add_note returns a proposal, stores it as pending, audits it — and posts nothing", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "add_note", { deal_id: danaId, text: "Called, left a voicemail." }));

    expect(p.summary).toContain("Dana Whitfield");
    expect(p.summary).toContain("Called, left a voicemail.");
    expect(await db.dealFeedPost.count({ where: { leadId: danaId } })).toBe(0);
    expect(await db.novaPendingAction.findUniqueOrThrow({ where: { id: p.pendingActionId } })).toMatchObject({
      status: "pending",
      actorId: ADA.id,
      tool: "add_note",
      leadId: danaId,
      vertical: "solar",
    });
    expect(await auditFor(p.pendingActionId)).toEqual([
      expect.objectContaining({ phase: "proposed", kind: "write", tool: "add_note", actorId: ADA.id, leadId: danaId }),
    ]);
  });
});

describe("confirming", () => {
  it("runs the write exactly once, as the user, and audits what it touched", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "add_note", { deal_id: danaId, text: "Confirmed note" }));

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    const posts = await db.dealFeedPost.findMany({ where: { leadId: danaId, body: "Confirmed note" } });
    expect(posts).toHaveLength(1);
    expect(posts[0].authorId).toBe(ADA.id);

    // A double click, or a replayed request, does not post twice.
    expect((await confirm(c, p.pendingActionId)).kind).not.toBe("done");
    expect(await db.dealFeedPost.count({ where: { leadId: danaId, body: "Confirmed note" } })).toBe(1);

    const executed = (await auditFor(p.pendingActionId)).filter((a) => a.phase === "executed");
    expect(executed).toHaveLength(1);
    expect(executed[0]).toMatchObject({
      tool: "add_note",
      kind: "write",
      actorId: ADA.id,
      vertical: "solar",
      leadId: danaId,
      entityType: "DealFeedPost",
      entityId: posts[0].id,
    });
    expect(executed[0].args).toMatchObject({ deal_id: danaId, text: "Confirmed note" });
    expect(executed[0].createdAt).toBeInstanceOf(Date);
  });

  it("cancelling writes nothing and is audited", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "add_note", { deal_id: danaId, text: "Never posted" }));

    expect((await cancel(c, p.pendingActionId)).kind).toBe("cancelled");
    expect((await confirm(c, p.pendingActionId)).kind).not.toBe("done");
    expect(await db.dealFeedPost.count({ where: { body: "Never posted" } })).toBe(0);
    expect((await auditFor(p.pendingActionId)).map((a) => a.phase)).toContain("cancelled");
  });

  it("an expired proposal is not run", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "add_note", { deal_id: danaId, text: "Too late" }));
    await db.novaPendingAction.update({
      where: { id: p.pendingActionId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    expect((await confirm(c, p.pendingActionId)).kind).toBe("expired");
    expect(await db.dealFeedPost.count({ where: { body: "Too late" } })).toBe(0);
    expect((await auditFor(p.pendingActionId)).map((a) => a.phase)).toContain("expired");
  });

  it("nobody else can confirm it — not even the owner", async () => {
    const p = proposal(await propose(as(ADA), "add_note", { deal_id: danaId, text: "Ada's to confirm" }));

    expect((await confirm(as(OLIVE), p.pendingActionId)).kind).toBe("missing");
    expect(await db.dealFeedPost.count({ where: { body: "Ada's to confirm" } })).toBe(0);

    // Still Ada's to confirm.
    expect((await confirm(as(ADA), p.pendingActionId)).kind).toBe("done");
  });

  it("asks again, and runs nothing, if what would happen has changed since", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "book_appointment", { deal_id: lenaId, when: "2026-10-01T10:00" }));
    expect(p.summary).toMatch(/Appointment Set/);

    // The deal moves on before the user says yes: booking would no longer move its stage.
    await db.lead.update({ where: { id: lenaId }, data: { stageId: stageSigned } });

    const out = await confirm(c, p.pendingActionId);
    expect(out.kind).toBe("confirm");
    expect(out.pending?.id).toBeDefined();
    expect(out.pending?.id).not.toBe(p.pendingActionId);
    expect(out.pending?.summary).not.toMatch(/Appointment Set/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: lenaId } })).appointmentAt).toBeNull();
  });
});

describe("refusals come from the portal's own rules, before anything is proposed", () => {
  it("a rep cannot note another rep's deal", async () => {
    const r = refusal(await propose(as(BEA), "add_note", { deal_id: danaId, text: "Not mine" }));
    expect(r.reason).toBe("refused");
    expect(await db.novaPendingAction.count({ where: { companyId, actorId: BEA.id } })).toBe(0);
    const audited = await db.novaAuditEvent.findMany({ where: { companyId, actorId: BEA.id, tool: "add_note" } });
    expect(audited).toEqual([expect.objectContaining({ phase: "refused", kind: "write" })]);
  });

  it("a Roofing deal is out of reach from Solar, and is not named", async () => {
    const r = refusal(await propose(as(ADA), "add_note", { deal_id: ritaId, text: "Wrong workspace" }));
    expect(r.reason).toBe("refused");
    expect(JSON.stringify(r)).not.toContain("Rita");
  });

  it("a rep cannot assign a task to someone else, and is told why", async () => {
    const r = refusal(await propose(as(ADA), "create_task", { title: "For Bea", assignee: "Bea" }));
    expect(r.reason).toBe("refused");
    expect(r.message).toMatch(/Sales Rep/);
  });
});

describe("each write tool", () => {
  it("create_task: a task for yourself", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "create_task", { title: "Order battery brochures", due_date: "2026-09-20" }));
    expect(p.summary).toContain("Order battery brochures");
    expect(p.summary).toContain("Sun, Sep 20, 2026");
    expect(await db.task.count({ where: { title: "Order battery brochures" } })).toBe(0);

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    const task = await db.task.findFirstOrThrow({ where: { companyId, title: "Order battery brochures" } });
    expect(task).toMatchObject({ assigneeId: ADA.id, createdById: ADA.id, vertical: "solar", leadId: null });
    const executed = (await auditFor(p.pendingActionId)).find((a) => a.phase === "executed");
    expect(executed).toMatchObject({ entityType: "Task", entityId: task.id });
  });

  it("create_task: someone who may assign can hand one to a rep", async () => {
    const c = as(OLIVE);
    const p = proposal(await propose(c, "create_task", { title: "Call the utility", assignee: "Bea" }));
    expect(p.summary).toContain("Bea Rep");

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    expect(await db.task.findFirstOrThrow({ where: { companyId, title: "Call the utility" } })).toMatchObject({
      assigneeId: BEA.id,
      createdById: OLIVE.id,
    });
  });

  it("create_follow_up: a task on the deal", async () => {
    const c = as(ADA);
    const p = proposal(
      await propose(c, "create_follow_up", { deal_id: danaId, title: "Send the battery spec sheet", due_date: "2026-09-18" })
    );
    expect(p.summary).toContain("Dana Whitfield");

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    const task = await db.task.findFirstOrThrow({ where: { companyId, title: "Send the battery spec sheet" } });
    expect(task).toMatchObject({ leadId: danaId, assigneeId: ADA.id, vertical: "solar" });
    expect(task.dueAt).not.toBeNull();
    expect((await auditFor(p.pendingActionId)).find((a) => a.phase === "executed")).toMatchObject({ leadId: danaId });
  });

  it("book_appointment: says the stage will move, and only moves it once confirmed", async () => {
    const c = as(ADA);
    const p = proposal(await propose(c, "book_appointment", { deal_id: danaId, when: "2026-09-15T14:00" }));
    expect(p.summary).toContain("Tue, Sep 15, 2026, 2:00 PM");
    expect(p.summary).toMatch(/New Lead/);
    expect(p.summary).toMatch(/Appointment Set/);
    expect((await db.lead.findUniqueOrThrow({ where: { id: danaId } })).appointmentAt).toBeNull();

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    const dana = await db.lead.findUniqueOrThrow({ where: { id: danaId } });
    expect(dana.appointmentAt?.toISOString()).toBe("2026-09-15T19:00:00.000Z");
    expect(dana.stageId).toBe(stageAppt);
  });

  it("set_appointment_outcome: only this company's Solar outcomes, by their real label", async () => {
    const c = as(ADA);
    const bad = refusal(await propose(c, "set_appointment_outcome", { deal_id: danaId, outcome: "maybe later" }));
    expect(bad.reason).toBe("invalid");
    expect(bad.message).toContain("Not interested");

    const p = proposal(await propose(c, "set_appointment_outcome", { deal_id: danaId, outcome: "not interested" }));
    expect(p.summary).toContain('"Not interested"');
    expect((await db.lead.findUniqueOrThrow({ where: { id: danaId } })).appointmentDisposition).toBeNull();

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    expect((await db.lead.findUniqueOrThrow({ where: { id: danaId } })).appointmentDisposition).toBe("Not interested");
  });

  it("create_lead: asks for the Solar required fields, never Roofing's", async () => {
    const r = refusal(
      await propose(as(ADA), "create_lead", { first_name: "Nina", last_name: "Park", phone: "214-555-0142" })
    );
    expect(r.reason).toBe("invalid");
    expect(r.message).toMatch(/Roof Type/);
    expect(r.message).not.toMatch(/Damage Type/);
  });

  it("create_lead: creates a Solar lead assigned the way the form would", async () => {
    const c = as(ADA);
    const p = proposal(
      await propose(c, "create_lead", {
        first_name: "Nina",
        last_name: "Park",
        phone: "214-555-0142",
        custom_fields: { "roof type": "tile" },
      })
    );
    expect(p.summary).toContain("Nina Park");
    expect(p.summary).toMatch(/New Lead/);
    expect(await db.lead.count({ where: { companyId, firstName: "Nina" } })).toBe(0);

    expect((await confirm(c, p.pendingActionId)).kind).toBe("done");
    const nina = await db.lead.findFirstOrThrow({ where: { companyId, firstName: "Nina", lastName: "Park" } });
    expect(nina).toMatchObject({ vertical: "solar", assignedRepId: ADA.id, createdById: ADA.id });
    expect(nina.customFields).toEqual({ roof_type: "Tile" });
    expect((await auditFor(p.pendingActionId)).find((a) => a.phase === "executed")).toMatchObject({
      entityType: "Lead",
      entityId: nina.id,
      leadId: nina.id,
    });
  });
});

describe("the deal's Activity tab", () => {
  it("shows every Nova write on the deal, by whom — and no reads or proposals", async () => {
    const items = await solar(() => getNovaActivity(companyId, danaId));
    const writes = await db.novaAuditEvent.count({
      where: { companyId, leadId: danaId, kind: "write", phase: { in: ["executed", "failed"] } },
    });
    expect(writes).toBeGreaterThan(0);
    expect(items).toHaveLength(writes);
    expect(items.every((i) => i.actor === "Ada Rep")).toBe(true);
    expect(items.map((i) => i.text).join(" | ")).toMatch(/note/i);
  });
});
