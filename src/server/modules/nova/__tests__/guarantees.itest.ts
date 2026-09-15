import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { utcToZonedWallClock } from "@/lib/tz";
import type { NovaCtx, ToolResult } from "../types";

/**
 * NOVA'S FIVE GUARANTEES, each proved against real Postgres and the portal's
 * real permission code.
 *
 *   1. A Sales Rep is refused what their role can't do — by the portal's own
 *      can() and row scope, not a copy of the rules — and is told why.
 *   2. Solar Nova never returns or touches a Roofing record.
 *   3. Every write produces an audit record, and appears on the deal's Activity tab.
 *   4. No write runs before confirmation.
 *   5. The sales summary is contract prices, not the dashboard's aggregate.
 *
 * Only the session and the workspace cookie are stubbed (there is no request
 * here). The portal's write actions are wrapped in spies that still do the real
 * work, so guarantee 4 can say exactly when one ran.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

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

vi.mock("@/server/modules/solar/cockpit-actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/solar/cockpit-actions")>();
  return { ...actual, postDealFeedAction: vi.fn(actual.postDealFeedAction) };
});
vi.mock("@/server/modules/tasks/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/tasks/actions")>();
  return { ...actual, createTaskAction: vi.fn(actual.createTaskAction) };
});
vi.mock("@/server/modules/leads/manage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/leads/manage")>();
  return {
    ...actual,
    createLeadAction: vi.fn(actual.createLeadAction),
    updateLeadPatchAction: vi.fn(actual.updateLeadPatchAction),
  };
});
vi.mock("@/server/modules/leads/actions", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/server/modules/leads/actions")>();
  return { ...actual, setAppointmentDispositionAction: vi.fn(actual.setAppointmentDispositionAction) };
});

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const { runInVertical } = await import("@/server/vertical/context");
const { runNovaTool } = await import("../tools/run");
const { runTurn } = await import("../loop");
const { confirmPendingAction, cancelPendingAction } = await import("../pending");
const { getNovaActivity } = await import("../activity");
const { resolvePageDeal } = await import("../page-context");
const { getDashboardStats } = await import("@/server/modules/dashboard/queries");
const cockpit = await import("@/server/modules/solar/cockpit-actions");
const tasks = await import("@/server/modules/tasks/actions");
const manage = await import("@/server/modules/leads/manage");
const leadActions = await import("@/server/modules/leads/actions");

/** Every portal action Nova can write through. */
const writeActions = () =>
  [
    cockpit.postDealFeedAction,
    tasks.createTaskAction,
    manage.createLeadAction,
    manage.updateLeadPatchAction,
    leadActions.setAppointmentDispositionAction,
  ] as unknown as ReturnType<typeof vi.fn>[];
const writeCalls = () => writeActions().reduce((n, f) => n + f.mock.calls.length, 0);

const TZ = "America/Chicago";
const NOW = new Date();
const daysFromNow = (n: number) => new Date(NOW.getTime() + n * 86_400_000);
const day = (n: number) => utcToZonedWallClock(daysFromNow(n), TZ).slice(0, 10);

type Who = { id: string; role: Role; first: string; last: string; permissions?: Record<string, boolean> };
let OLIVE: Who;
let ADA: Who;
let BEA: Who;

let companyId = "";
/** Solar, Ada's. Signed two days ago on an approved $50,800 contract. */
let danaId = "";
/** Solar, Ada's, at New Lead: where the confirmed writes land. */
let lenaId = "";
/** Solar, Bea's. */
let omarId = "";
/** Roofing, Ada's: Dana's twin — same name, same phone. */
let roofId = "";

/** Anything that could only have come from Roofing. */
const roofingMarkers = () => [roofId, "Order shingles", "Roofwright", "99,000"];
const leaks = (value: unknown) => roofingMarkers().filter((m) => JSON.stringify(value).includes(m));

function as(who: Who, page: NovaCtx["page"] = null): NovaCtx {
  const fullName = `${who.first} ${who.last}`;
  const permissions = who.permissions ?? {};
  current = {
    userId: who.id,
    companyId,
    role: who.role,
    permissions,
    fullName,
    firstName: who.first,
    lastName: who.last,
    email: null,
    companySlug: "nova-guarantees",
    avatarUrl: null,
    title: null,
    verticals: ["roofing", "solar"],
  };
  return {
    user: { userId: who.id, companyId, role: who.role, permissions, fullName },
    conversationId: `guarantees-${who.id}`,
    timeZone: TZ,
    now: NOW,
    page,
  };
}

const solar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);
const call = (c: NovaCtx, tool: string, input: unknown) => solar(() => runNovaTool(c, tool, input));
const confirm = (c: NovaCtx, id: string) => solar(() => confirmPendingAction(c, id));

function data(r: ToolResult): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r.data;
}
function pendingId(r: ToolResult): string {
  if (!r.ok || !r.proposal) throw new Error(`expected a proposal, got ${JSON.stringify(r)}`);
  return r.proposal.pendingActionId;
}

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "__tests__" ? [] : walk(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  companyId = (
    await db.company.create({ data: { name: "Nova Guarantees Co", slug: `nova-g-${stamp}`, timezone: TZ } })
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

  const stage = (pipelineId: string, key: string, name: string, position: number, extra = {}) =>
    db.pipelineStage.create({ data: { pipelineId, key, name, position, ...extra } });
  const solarPipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar", isDefault: true } });
  const sNew = await stage(solarPipe.id, "new_lead", "New Lead", 0);
  await stage(solarPipe.id, "appointment_set", "Appointment Set", 1);
  const sSigned = await stage(solarPipe.id, "contract_signed", "Contract Signed", 2, { countsAsSold: true });
  const roofPipe = await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing", isDefault: true } });
  const rNew = await stage(roofPipe.id, "new_lead", "New Lead", 0);
  const rSigned = await stage(roofPipe.id, "contract_signed", "Contract Signed", 1, { countsAsSold: true });

  const lead = async (data: Record<string, unknown>) =>
    (await db.lead.create({ data: { companyId, stageChangedAt: NOW, ...data } as never })).id;
  const solarLead = { vertical: "solar", serviceType: "solar", pipelineId: solarPipe.id };

  danaId = await lead({
    ...solarLead,
    stageId: sSigned.id,
    stageChangedAt: daysFromNow(-2),
    firstName: "Dana",
    lastName: "Whitfield",
    phone: "(214) 555-0101",
    assignedRepId: ADA.id,
    createdById: ADA.id,
    // The after-credit figure the pipeline board shows. Not the contract.
    value: 3_800_000,
    appointmentAt: daysFromNow(2),
  });
  lenaId = await lead({ ...solarLead, stageId: sNew.id, firstName: "Lena", lastName: "Moss", assignedRepId: ADA.id, createdById: ADA.id });
  omarId = await lead({ ...solarLead, stageId: sNew.id, firstName: "Omar", lastName: "Castillo", assignedRepId: BEA.id, createdById: BEA.id });
  roofId = await lead({
    vertical: "roofing",
    pipelineId: roofPipe.id,
    stageId: rSigned.id,
    stageChangedAt: daysFromNow(-2),
    firstName: "Dana",
    lastName: "Whitfield",
    phone: "(214) 555-0101",
    assignedRepId: ADA.id,
    createdById: ADA.id,
    value: 9_900_000,
    appointmentAt: daysFromNow(2),
  });
  await lead({
    vertical: "roofing",
    pipelineId: roofPipe.id,
    stageId: rNew.id,
    firstName: "Rhoda",
    lastName: "Roofwright",
    assignedRepId: ADA.id,
    createdById: ADA.id,
    appointmentAt: daysFromNow(1),
  });

  await db.leadStageEvent.create({
    data: { leadId: danaId, stageId: sSigned.id, stageName: "Contract Signed", position: 2, enteredAt: daysFromNow(-2) },
  });
  await db.leadStageEvent.create({
    data: { leadId: roofId, stageId: rSigned.id, stageName: "Contract Signed", position: 1, enteredAt: daysFromNow(-2) },
  });

  await db.solarProposal.create({
    data: {
      companyId,
      leadId: danaId,
      vertical: "solar",
      version: 1,
      status: "generated",
      approvedAt: daysFromNow(-2),
      snapshot: {
        schemaVersion: 7,
        system: { sizeKwDc: 11, moduleQty: 25, year1ProductionKwh: 15_000, offsetPct: 104, moduleLabel: null, inverterLabel: null, batteryLabel: null },
        financing: {
          product: "loan",
          contractPriceCents: 5_080_000,
          grossPpwCents: null,
          basePriceCents: null,
          adderTotalCents: null,
          monthlyPaymentCents: null,
          rateMillsPerKwh: null,
          creditLadder: { netCostCents: 3_800_000 },
        },
      },
    },
  });

  // What the dashboard adds up: finished jobs' project values. Deliberately a
  // different figure from the signed contract, so the two can't be confused.
  await db.project.create({
    data: { companyId, leadId: danaId, vertical: "solar", projectNumber: `NG-S-${stamp}`, status: "completed", serviceType: "solar", contractValue: 5_600_000 },
  });
  await db.project.create({
    data: { companyId, leadId: roofId, vertical: "roofing", projectNumber: `NG-R-${stamp}`, status: "completed", serviceType: "roofing", contractValue: 9_900_000 },
  });

  await db.task.createMany({
    data: [
      { companyId, vertical: "solar", title: "Call Dana about the battery", assigneeId: ADA.id, createdById: OLIVE.id, leadId: danaId },
      { companyId, vertical: "roofing", title: "Order shingles", assigneeId: ADA.id, createdById: OLIVE.id, leadId: roofId },
    ],
  });
});

afterAll(async () => {
  await db.novaAuditEvent.deleteMany({ where: { companyId } });
  await db.novaPendingAction.deleteMany({ where: { companyId } });
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("1 · A Sales Rep is refused what their role can't do — by the portal's own rules", () => {
  it("refuses a rep the lookup the Team page refuses them, says why, and audits it", async () => {
    const r = await call(as(ADA), "get_team_member", { name: "Bea" });
    expect(r).toMatchObject({ ok: false, reason: "refused" });
    expect(!r.ok && r.message).toMatch(/Sales Rep/);
    const audit = await db.novaAuditEvent.findFirst({
      where: { companyId, actorId: ADA.id, tool: "get_team_member" },
      orderBy: { createdAt: "desc" },
    });
    expect(audit).toMatchObject({ phase: "refused", kind: "read" });
  });

  it("follows a per-user grant or revocation exactly as the portal does — the rule is can(), not a copy", async () => {
    expect((await call(as({ ...ADA, permissions: { "User:read": true } }), "get_team_member", { name: "Bea" })).ok).toBe(true);
    expect(await call(as({ ...OLIVE, permissions: { "User:read": false } }), "get_team_member", { name: "Bea" })).toMatchObject({
      ok: false,
      reason: "refused",
    });
  });

  it("refuses a rep a write their role can't make, before anything is proposed", async () => {
    const pendingBefore = await db.novaPendingAction.count({ where: { companyId } });
    const r = await call(as(ADA), "create_task", { title: "For Bea", assignee: "Bea" });
    expect(r).toMatchObject({ ok: false, reason: "refused" });
    expect(!r.ok && r.message).toMatch(/Sales Rep/);
    expect(await db.novaPendingAction.count({ where: { companyId } })).toBe(pendingBefore);

    const granted = await call(as({ ...ADA, permissions: { "Task:assign": true } }), "create_task", { title: "For Bea", assignee: "Bea" });
    expect(granted.ok && granted.proposal).toBeTruthy();
  });

  it("refuses a rep another rep's deal — row scope, not only role", async () => {
    expect(await call(as(ADA), "get_deal", { deal_id: omarId })).toMatchObject({ ok: false, reason: "refused" });
    expect(await call(as(ADA), "add_note", { deal_id: omarId, text: "Not my deal" })).toMatchObject({ ok: false, reason: "refused" });
  });

  it("decides permissions only through the portal's permission modules — no role names of its own", () => {
    const src = walk(join(process.cwd(), "src/server/modules/nova"))
      .map((f) => readFileSync(f, "utf8"))
      .join("\n");
    expect(src).toContain('from "@/server/rbac/guards"');
    expect(src).toContain('from "@/server/rbac/policies"');
    expect(src).toContain('from "@/server/rbac/lead-access"');
    // `role === "sales_rep"` anywhere in Nova would be a second copy of the matrix.
    expect(src.match(/["'](super_admin|admin|manager|sales_rep|canvasser|installer|accounting|marketing)["']/g) ?? []).toEqual([]);
  });
});

describe("2 · Solar Nova never returns or touches a Roofing record", () => {
  it("no read tool returns anything from Roofing — even for the owner, who may see both", async () => {
    const c = as(OLIVE);
    const reads: [string, unknown][] = [
      ["find_deal", { query: "Dana Whitfield" }],
      ["find_deal", { query: "214-555-0101" }],
      ["find_deal", { query: "Roofwright" }],
      ["get_deal", { deal_id: roofId }],
      ["list_deals", {}],
      ["list_deals", { stage: "Contract" }],
      ["get_pipeline_summary", {}],
      ["get_sales_summary", { from: day(-30), to: day(0) }],
      ["list_appointments", { from: day(0), to: day(7) }],
      ["list_tasks", { status: "open" }],
    ];
    for (const [tool, input] of reads) {
      expect(leaks(await call(c, tool, input)), `${tool} ${JSON.stringify(input)}`).toEqual([]);
    }

    // Not vacuous: the Solar twin IS found, and the Roofing one is refused outright.
    expect(JSON.stringify(await call(c, "find_deal", { query: "Dana Whitfield" }))).toContain(danaId);
    expect(JSON.stringify(await call(c, "list_appointments", { from: day(0), to: day(7) }))).toContain(danaId);
    expect(JSON.stringify(await call(c, "list_tasks", { status: "open" }))).toContain("Call Dana about the battery");
    expect(await call(c, "get_deal", { deal_id: roofId })).toMatchObject({ ok: false });
  });

  it("no write tool will touch a Roofing deal, and nothing is even proposed", async () => {
    const c = as(ADA);
    const before = await db.lead.findUniqueOrThrow({ where: { id: roofId } });
    const pendingBefore = await db.novaPendingAction.count({ where: { companyId } });
    const writes: [string, unknown][] = [
      ["add_note", { deal_id: roofId, text: "Wrong workspace" }],
      ["create_follow_up", { deal_id: roofId, title: "Wrong workspace" }],
      ["book_appointment", { deal_id: roofId, when: `${day(10)}T10:00` }],
      ["set_appointment_outcome", { deal_id: roofId, outcome: "Not interested" }],
    ];
    for (const [tool, input] of writes) {
      const r = await call(c, tool, input);
      expect(r, tool).toMatchObject({ ok: false, reason: "refused" });
      expect(leaks(r), tool).toEqual([]);
    }
    expect(await db.novaPendingAction.count({ where: { companyId } })).toBe(pendingBefore);
    expect(await db.lead.findUniqueOrThrow({ where: { id: roofId } })).toEqual(before);
    expect(await db.dealFeedPost.count({ where: { leadId: roofId } })).toBe(0);
  });

  it("a Roofing deal on screen is never 'this deal'", async () => {
    const owner = as(OLIVE).user;
    expect(await solar(() => resolvePageDeal(owner, `/portal/leads/${roofId}`))).toBeNull();
    expect(await solar(() => resolvePageDeal(owner, `/portal/leads/${danaId}`))).toMatchObject({ leadId: danaId });
  });
});

describe("3 · Every write produces an audit record and appears on the deal's Activity tab", () => {
  async function proposeAndConfirm(c: NovaCtx, tool: string, input: unknown) {
    const id = pendingId(await call(c, tool, input));
    const out = await confirm(c, id);
    expect(out.kind, `${tool}: ${out.reply}`).toBe("done");
    const rows = await db.novaAuditEvent.findMany({ where: { companyId, pendingActionId: id, phase: "executed" } });
    expect(rows, tool).toHaveLength(1);
    return rows[0];
  }

  it.each([
    ["add_note", () => ({ deal_id: lenaId, text: "Left a voicemail about the site survey." })],
    ["create_follow_up", () => ({ deal_id: lenaId, title: "Send the site survey checklist", due_date: day(3) })],
    ["book_appointment", () => ({ deal_id: lenaId, when: `${day(5)}T15:00` })],
    ["set_appointment_outcome", () => ({ deal_id: lenaId, outcome: "Proposal presented — deciding" })],
  ])("%s: one row saying who, when, what, with what, and on which deal — shown on its Activity tab", async (tool, input) => {
    const row = await proposeAndConfirm(as(ADA), tool, input());

    expect(row).toMatchObject({ actorId: ADA.id, tool, kind: "write", vertical: "solar", leadId: lenaId });
    expect(row.createdAt).toBeInstanceOf(Date);
    expect(row.args).toMatchObject({ deal_id: lenaId });
    expect((row.result as { done?: string }).done).toBeTruthy();
    expect(row.entityType).toBeTruthy();

    const activity = await solar(() => getNovaActivity(companyId, lenaId));
    expect(activity.find((a) => a.id === row.id)).toMatchObject({ actor: "Ada Rep", failed: false });
  });

  it("create_lead: audited against the deal it created, and on that deal's Activity tab", async () => {
    const row = await proposeAndConfirm(as(ADA), "create_lead", { first_name: "Nina", last_name: "Park", phone: "214-555-0142" });
    expect(row).toMatchObject({ actorId: ADA.id, tool: "create_lead", entityType: "Lead" });
    expect(row.leadId).toBeTruthy();
    expect(row.leadId).toBe(row.entityId);
    expect((await solar(() => getNovaActivity(companyId, row.leadId!))).map((a) => a.id)).toEqual([row.id]);
  });

  it("create_task: a task on no deal is audited too", async () => {
    const row = await proposeAndConfirm(as(ADA), "create_task", { title: "Restock door hangers" });
    expect(row).toMatchObject({ actorId: ADA.id, tool: "create_task", entityType: "Task", leadId: null });
    expect(row.entityId).toBeTruthy();
  });

  it("reads are audited as well — every call, refused ones included", async () => {
    const count = () => db.novaAuditEvent.count({ where: { companyId, actorId: ADA.id, kind: "read" } });
    const before = await count();
    await call(as(ADA), "find_deal", { query: "Lena" });
    await call(as(ADA), "get_team_member", { name: "Bea" });
    expect(await count()).toBe(before + 2);
  });
});

describe("4 · No write runs before confirmation", () => {
  const stateOf = async (leadId: string) => ({
    lead: await db.lead.findUniqueOrThrow({ where: { id: leadId } }),
    posts: await db.dealFeedPost.count({ where: { companyId } }),
    tasks: await db.task.count({ where: { companyId } }),
    leads: await db.lead.count({ where: { companyId } }),
  });

  it.each([
    ["add_note", () => ({ deal_id: danaId, text: "Proposed only" })],
    ["create_follow_up", () => ({ deal_id: danaId, title: "Proposed only" })],
    ["create_task", () => ({ title: "Proposed only" })],
    ["create_lead", () => ({ first_name: "Proposed", last_name: "Only" })],
    ["book_appointment", () => ({ deal_id: danaId, when: `${day(9)}T09:30` })],
    ["set_appointment_outcome", () => ({ deal_id: danaId, outcome: "Not interested" })],
  ])("%s: proposing calls no portal action and changes nothing", async (tool, input) => {
    const before = await stateOf(danaId);
    const calls = writeCalls();

    pendingId(await call(as(ADA), tool, input()));

    expect(writeCalls()).toBe(calls);
    expect(await stateOf(danaId)).toEqual(before);
  });

  it("the conversation loop cannot write: a model that calls a write tool gets a question, not a change", async () => {
    const c = as(ADA, { leadId: danaId, name: "Dana Whitfield" });
    const before = await stateOf(danaId);
    const calls = writeCalls();
    const model = {
      create: vi.fn(async () => ({
        id: "m",
        type: "message",
        role: "assistant",
        model: "scripted",
        stop_reason: "tool_use",
        usage: {},
        content: [{ type: "tool_use", id: "t1", name: "add_note", input: { text: "From the loop" } }],
      })),
    };

    const out = await solar(() =>
      runTurn(c, { text: "note that I called", history: [] }, { model: model as never, runTool: runNovaTool })
    );

    expect(out.kind).toBe("confirm");
    expect(out.pending?.summary).toContain("Dana Whitfield");
    expect(writeCalls()).toBe(calls);
    expect(await stateOf(danaId)).toEqual(before);

    // The yes is what runs it — once.
    expect((await confirm(c, out.pending!.id)).kind).toBe("done");
    expect(writeCalls()).toBe(calls + 1);
    expect((await confirm(c, out.pending!.id)).kind).not.toBe("done");
    expect(writeCalls()).toBe(calls + 1);
  });

  it("a confirmation that isn't yours, comes too late, or follows a cancel runs nothing", async () => {
    const propose = async (text: string) => pendingId(await call(as(ADA), "add_note", { deal_id: danaId, text }));
    const calls = writeCalls();

    const someoneElses = await propose("Not yours to confirm");
    expect((await confirm(as(OLIVE), someoneElses)).kind).toBe("missing");

    const late = await propose("Too late");
    await db.novaPendingAction.update({ where: { id: late }, data: { expiresAt: new Date(Date.now() - 1_000) } });
    expect((await confirm(as(ADA), late)).kind).toBe("expired");

    const cancelled = await propose("Cancelled first");
    expect((await solar(() => cancelPendingAction(as(ADA), cancelled))).kind).toBe("cancelled");
    expect((await confirm(as(ADA), cancelled)).kind).toBe("missing");

    expect(writeCalls()).toBe(calls);
    expect(
      await db.dealFeedPost.count({
        where: { leadId: danaId, body: { in: ["Not yours to confirm", "Too late", "Cancelled first"] } },
      })
    ).toBe(0);
  });
});

describe("5 · The sales summary is contract prices, not the dashboard's aggregate", () => {
  it("reports signed contracts at their approved proposal's contract price, and says so", async () => {
    const d = data(await call(as(OLIVE), "get_sales_summary", { from: day(-30), to: day(0) }));
    expect(d).toMatchObject({ contracts_signed: 1, total_contract_value: "$50,800", deals_without_contract_price: [] });
    expect(String(d.definition)).toMatch(/contract price/i);
    expect(String(d.definition)).toMatch(/Contract Signed/);
  });

  it("on the same records the dashboard's figures say something else — which is why Nova doesn't use them", async () => {
    const c = as(OLIVE);

    // Dashboard revenue adds up finished projects' contractValue…
    const stats = await solar(() => getDashboardStats(current as never, "solar"));
    expect(stats.revenueCents).toBe(5_600_000);
    // …and the deal's stamped value is the price after tax credits.
    expect((await db.lead.findUniqueOrThrow({ where: { id: danaId } })).value).toBe(3_800_000);

    // Nova's figure is the contract: neither of those.
    const sales = data(await call(c, "get_sales_summary", { from: day(-30), to: day(0) }));
    expect(sales.total_contract_value).toBe("$50,800");
    expect(JSON.stringify(sales)).not.toMatch(/\$56,000|\$38,000/);

    const pipeline = data(await call(c, "get_pipeline_summary", {}));
    expect((pipeline.stages as Record<string, unknown>[]).find((s) => s.stage === "Contract Signed")).toMatchObject({
      deals: 1,
      contract_value: "$50,800",
    });
  });
});
