import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { utcToZonedWallClock } from "@/lib/tz";
import type { NovaCtx, ToolResult } from "../types";

/**
 * Nova's read tools against real Postgres.
 *
 * `can()` and `listScope()` are NOT mocked: the refusals below come from the
 * same permission code the portal runs. Every Solar fixture that matters has a
 * Roofing twin with the same name and phone, so a leak across workspaces shows
 * up as an extra match rather than passing unnoticed.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const { runInVertical } = await import("@/server/vertical/context");
const { runNovaTool } = await import("../tools/run");

const TZ = "America/Chicago";
const NOW = new Date();
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);
const day = (d: Date) => utcToZonedWallClock(d, TZ).slice(0, 10);

let companyId = "";
let adminId = "";
let repA = "";
let repB = "";
let danaId = "";
let omarId = "";
let priyaId = "";
let goneId = "";
let ezraId = "";
let roofDanaId = "";

function ctx(userId: string, role: Role, fullName: string, page: NovaCtx["page"] = null): NovaCtx {
  return {
    user: { userId, companyId, role, permissions: {}, fullName },
    conversationId: "itest-reads",
    timeZone: TZ,
    now: NOW,
    page,
  };
}
const admin = (page: NovaCtx["page"] = null) => ctx(adminId, "super_admin", "Olive Owner", page);
const ada = () => ctx(repA, "sales_rep", "Ada Rep");
const bea = () => ctx(repB, "sales_rep", "Bea Rep");

const call = (c: NovaCtx, name: string, input: unknown) =>
  runInVertical("solar", () => runNovaTool(c, name, input));

function data(r: ToolResult): Record<string, unknown> {
  if (!r.ok) throw new Error(`expected ok, got ${r.reason}: ${r.message}`);
  return r.data;
}
type Row = Record<string, unknown>;
const rows = (r: ToolResult, key: string) => data(r)[key] as Row[];

const snapshot = (contractPriceCents: number, netCostCents: number | null) => ({
  schemaVersion: 7,
  system: {
    sizeKwDc: 11,
    moduleQty: 25,
    year1ProductionKwh: 15_000,
    offsetPct: 104.4,
    moduleLabel: "REC 440",
    inverterLabel: null,
    batteryLabel: null,
  },
  financing: {
    product: "loan",
    contractPriceCents,
    grossPpwCents: null,
    basePriceCents: null,
    adderTotalCents: null,
    monthlyPaymentCents: null,
    rateMillsPerKwh: null,
    ...(netCostCents == null ? {} : { creditLadder: { netCostCents } }),
  },
});

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  companyId = (
    await db.company.create({ data: { name: "Nova Reads Co", slug: `nova-reads-${stamp}`, timezone: TZ } })
  ).id;

  const user = async (key: string, firstName: string, lastName: string, role: Role) =>
    (
      await db.user.create({
        data: {
          companyId,
          email: `${key}-${stamp}@nova.test`,
          firstName,
          lastName,
          role,
          status: "active",
          passwordHash: "x",
          verticals: ["roofing", "solar"],
        },
      })
    ).id;
  adminId = await user("owner", "Olive", "Owner", "super_admin");
  repA = await user("ada", "Ada", "Rep", "sales_rep");
  repB = await user("bea", "Bea", "Rep", "sales_rep");

  const solar = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar", isDefault: true },
  });
  const stage = (pipelineId: string, key: string, name: string, position: number, extra = {}) =>
    db.pipelineStage.create({ data: { pipelineId, key, name, position, ...extra } });
  await stage(solar.id, "new_lead", "New Lead", 0);
  const sSigned = await stage(solar.id, "contract_signed", "Contract Signed", 2, { countsAsSold: true });
  const sPermit = await stage(solar.id, "permitting", "Permitting", 3, {
    stageType: "externally_blocked",
    targetDays: 5,
  });
  const sInstall = await stage(solar.id, "install", "Install", 4, { targetDays: 3 });
  const sCancel = await stage(solar.id, "cancelled", "Cancelled", 9, { isLost: true });

  const roofing = await db.pipeline.create({
    data: { companyId, name: "Roofing", vertical: "roofing", isDefault: true },
  });
  const rSigned = await stage(roofing.id, "contract_signed", "Contract Signed", 1, { countsAsSold: true });

  const lead = async (data: Record<string, unknown>) =>
    (await db.lead.create({ data: { companyId, ...data } as never })).id;

  danaId = await lead({
    vertical: "solar",
    pipelineId: solar.id,
    stageId: sSigned.id,
    stageChangedAt: daysAgo(2),
    firstName: "Dana",
    lastName: "Whitfield",
    phone: "(214) 555-0101",
    address: "1903 N Depot St",
    city: "Victoria",
    assignedRepId: repA,
    createdById: repA,
    value: 3_800_000,
    appointmentAt: daysAgo(-3),
  });
  omarId = await lead({
    vertical: "solar",
    pipelineId: solar.id,
    stageId: sInstall.id,
    stageChangedAt: daysAgo(8),
    firstName: "Omar",
    lastName: "Castillo",
    phone: "2145550199",
    assignedRepId: repB,
    createdById: repB,
  });
  priyaId = await lead({
    vertical: "solar",
    pipelineId: solar.id,
    stageId: sPermit.id,
    stageChangedAt: daysAgo(20),
    firstName: "Priya",
    lastName: "Nair",
    assignedRepId: repA,
    createdById: repA,
  });
  goneId = await lead({
    vertical: "solar",
    pipelineId: solar.id,
    stageId: sCancel.id,
    firstName: "Dana",
    lastName: "Gone",
    assignedRepId: repA,
    createdById: repA,
  });
  ezraId = await lead({
    vertical: "solar",
    pipelineId: solar.id,
    stageId: sSigned.id,
    stageChangedAt: daysAgo(60),
    firstName: "Ezra",
    lastName: "Early",
    assignedRepId: repA,
    createdById: repA,
  });
  roofDanaId = await lead({
    vertical: "roofing",
    pipelineId: roofing.id,
    stageId: rSigned.id,
    stageChangedAt: daysAgo(2),
    firstName: "Dana",
    lastName: "Whitfield",
    phone: "(214) 555-0101",
    assignedRepId: repA,
    createdById: repA,
    value: 9_900_000,
    appointmentAt: daysAgo(-3),
  });

  const event = (leadId: string, s: { id: string; name: string; position: number }, enteredAt: Date, exitedAt: Date | null = null) =>
    db.leadStageEvent.create({
      data: { leadId, stageId: s.id, stageName: s.name, position: s.position, enteredAt, exitedAt },
    });
  await event(danaId, sSigned, daysAgo(2));
  await event(omarId, sSigned, daysAgo(12), daysAgo(8));
  await event(omarId, sInstall, daysAgo(8));
  await event(ezraId, sSigned, daysAgo(60));
  await event(roofDanaId, rSigned, daysAgo(2));

  const lender = await db.solarLender.create({ data: { companyId, vertical: "solar", name: "Amos" } });
  await db.solarDesign.create({
    data: {
      companyId,
      leadId: danaId,
      vertical: "solar",
      systemSizeKwDc: 11,
      moduleQty: 25,
      offsetPct: 104.4,
      lenderId: lender.id,
    },
  });
  await db.solarFinance.create({ data: { companyId, leadId: danaId, vertical: "solar", product: "loan" } });

  const proposal = (leadId: string, version: number, contract: number, net: number | null, approvedAt: Date | null) =>
    db.solarProposal.create({
      data: {
        companyId,
        leadId,
        vertical: "solar",
        version,
        status: "generated",
        snapshot: snapshot(contract, net),
        approvedAt,
      },
    });
  // v2 is the approved one; v3 is a newer, bigger draft generated afterwards.
  await proposal(danaId, 1, 6_000_000, null, null);
  await proposal(danaId, 2, 5_080_000, 3_800_000, daysAgo(2));
  await proposal(danaId, 3, 7_100_000, 5_300_000, null);
  await proposal(ezraId, 1, 2_500_000, null, daysAgo(60));

  await db.task.createMany({
    data: [
      { companyId, vertical: "solar", title: "Call Dana about battery", assigneeId: repA, createdById: adminId, leadId: danaId, dueAt: daysAgo(-1) },
      { companyId, vertical: "roofing", title: "Order shingles", assigneeId: repA, createdById: adminId },
      { companyId, vertical: null, title: "Submit timesheet", assigneeId: repB, createdById: adminId },
    ],
  });
});

afterAll(async () => {
  await db.novaAuditEvent.deleteMany({ where: { companyId } });
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("find_deal", () => {
  it("matches by name inside Solar and never returns the Roofing twin", async () => {
    const ids = rows(await call(admin(), "find_deal", { query: "Dana Whitfield" }), "matches").map((m) => m.deal_id);
    expect(ids).toEqual([danaId]);
  });

  it("matches a phone typed in the other format", async () => {
    const ids = rows(await call(admin(), "find_deal", { query: "214-555-0101" }), "matches").map((m) => m.deal_id);
    expect(ids).toEqual([danaId]);
    const omar = rows(await call(admin(), "find_deal", { query: "(214) 555 0199" }), "matches").map((m) => m.deal_id);
    expect(omar).toEqual([omarId]);
  });

  it("leaves cancelled deals out", async () => {
    const ids = rows(await call(admin(), "find_deal", { query: "Dana" }), "matches").map((m) => m.deal_id);
    expect(ids).toContain(danaId);
    expect(ids).not.toContain(goneId);
    expect(ids).not.toContain(roofDanaId);
  });

  it("a rep finds only the deals they can open", async () => {
    expect(rows(await call(bea(), "find_deal", { query: "Dana" }), "matches")).toEqual([]);
    const ids = rows(await call(bea(), "find_deal", { query: "Omar" }), "matches").map((m) => m.deal_id);
    expect(ids).toEqual([omarId]);
  });
});

describe("get_deal", () => {
  it("reports the approved proposal's contract price — not the after-credit value, not a newer draft", async () => {
    const d = data(await call(admin(), "get_deal", { deal_id: danaId }));
    expect(d).toMatchObject({
      customer: "Dana Whitfield",
      stage: "Contract Signed",
      days_in_stage: 2,
      assigned_rep: "Ada Rep",
      system_size: "11.00 kW",
      panel_count: "25",
      offset: "104%",
      financing_product: "Loan",
      lender: "Amos",
      contract_price: "$50,800",
    });
    expect(String(d.contract_price_source)).toMatch(/v2/);
    expect(String(d.contract_price_source)).toMatch(/approved/i);
  });

  it("says what isn't set instead of guessing", async () => {
    const d = data(await call(admin(), "get_deal", { deal_id: omarId }));
    expect(d).toMatchObject({
      customer: "Omar Castillo",
      contract_price: "not set",
      system_size: "not set",
      panel_count: "not set",
      lender: "not set",
      financing_product: "not set",
    });
    expect(String(d.contract_price_source)).toMatch(/no proposal/i);
  });

  it("uses the deal on screen when no id is given", async () => {
    const d = data(await call(admin({ leadId: danaId, name: "Dana Whitfield" }), "get_deal", {}));
    expect(d.deal_id).toBe(danaId);
  });

  it("will not open a Roofing deal from Solar, even by exact id", async () => {
    const r = await call(admin(), "get_deal", { deal_id: roofDanaId });
    expect(r.ok).toBe(false);
    expect(JSON.stringify(r)).not.toContain("99,000");
  });

  it("will not open another rep's deal", async () => {
    const r = await call(bea(), "get_deal", { deal_id: danaId });
    expect(r).toMatchObject({ ok: false, reason: "refused" });
  });
});

describe("list_deals", () => {
  it("overdue follows the stage alerts: our own stages only, never a utility's queue", async () => {
    const d = rows(await call(admin(), "list_deals", { overdue: true }), "deals");
    expect(d.map((x) => x.deal_id)).toEqual([omarId]);
    expect(d[0].overdue_by_days).toBe(5);
    expect(d.map((x) => x.deal_id)).not.toContain(priyaId);
  });

  it("filters by stage name", async () => {
    const ids = rows(await call(admin(), "list_deals", { stage: "contract" }), "deals").map((x) => x.deal_id);
    expect(ids.sort()).toEqual([danaId, ezraId].sort());
  });

  it("filters by rep name", async () => {
    const ids = rows(await call(admin(), "list_deals", { rep: "Bea" }), "deals").map((x) => x.deal_id);
    expect(ids).toEqual([omarId]);
  });
});

describe("get_pipeline_summary", () => {
  it("counts and values each stage by contract price", async () => {
    const stages = rows(await call(admin(), "get_pipeline_summary", {}), "stages");
    const signed = stages.find((s) => s.stage === "Contract Signed")!;
    expect(signed).toMatchObject({ deals: 2, contract_value: "$75,800", deals_without_contract_price: 0 });
    const install = stages.find((s) => s.stage === "Install")!;
    expect(install).toMatchObject({ deals: 1, contract_value: "$0", deals_without_contract_price: 1 });
  });
});

describe("get_sales_summary", () => {
  it("sums contract prices of deals that reached Contract Signed in the period, and says so", async () => {
    const d = data(
      await call(admin(), "get_sales_summary", { from: day(daysAgo(30)), to: day(NOW) })
    );
    expect(d).toMatchObject({
      contracts_signed: 2,
      total_contract_value: "$50,800",
      deals_without_contract_price: ["Omar Castillo"],
    });
    expect(String(d.definition)).toMatch(/contract price/i);
    expect(String(d.definition)).toMatch(/Contract Signed/);
  });

  it("a rep hears only their own deals", async () => {
    const d = data(await call(ada(), "get_sales_summary", { from: day(daysAgo(30)), to: day(NOW) }));
    expect(d).toMatchObject({ contracts_signed: 1, total_contract_value: "$50,800" });
  });
});

describe("list_appointments", () => {
  it("lists Solar appointments in the range and not the Roofing one at the same time", async () => {
    const appts = rows(
      await call(admin(), "list_appointments", { from: day(NOW), to: day(daysAgo(-7)) }),
      "appointments"
    );
    expect(appts.map((a) => a.deal_id)).toEqual([danaId]);
  });
});

describe("list_tasks", () => {
  it("a rep sees their own Solar tasks, not Roofing ones and not other people's", async () => {
    const titles = rows(await call(ada(), "list_tasks", {}), "tasks").map((t) => t.title);
    expect(titles).toContain("Call Dana about battery");
    expect(titles).not.toContain("Order shingles");
    expect(titles).not.toContain("Submit timesheet");
  });

  it("company-wide tasks show in Solar; Roofing tasks never do", async () => {
    const titles = rows(await call(admin(), "list_tasks", { status: "open" }), "tasks").map((t) => t.title);
    expect(titles).toContain("Submit timesheet");
    expect(titles).not.toContain("Order shingles");
  });
});

describe("get_team_member", () => {
  it("refuses a sales rep, the same way the Team page does", async () => {
    const r = await call(ada(), "get_team_member", { name: "Bea" });
    expect(r).toMatchObject({ ok: false, reason: "refused" });
    if (!r.ok) expect(r.message).toMatch(/Sales Rep/);
  });

  it("finds a teammate for an owner", async () => {
    const m = rows(await call(admin(), "get_team_member", { name: "Bea" }), "matches");
    expect(m[0]).toMatchObject({ name: "Bea Rep", role: "Sales Rep" });
  });
});

describe("audit", () => {
  it("writes one row per call — refusals included — with actor, tool, arguments and result", async () => {
    await db.novaAuditEvent.deleteMany({ where: { companyId } });
    await call(admin(), "find_deal", { query: "Omar" });
    await call(ada(), "get_team_member", { name: "Bea" });

    const log = await db.novaAuditEvent.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } });
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({
      actorId: adminId,
      tool: "find_deal",
      kind: "read",
      phase: "executed",
      vertical: "solar",
      args: { query: "Omar" },
    });
    expect(JSON.stringify(log[0].result)).toContain("Omar Castillo");
    expect(log[1]).toMatchObject({ actorId: repA, tool: "get_team_member", phase: "refused" });
    expect(log[1].error).toMatch(/Sales Rep/);
  });

  it("records the deal a read touched", async () => {
    await call(admin(), "get_deal", { deal_id: danaId });
    const row = await db.novaAuditEvent.findFirst({
      where: { companyId, tool: "get_deal" },
      orderBy: { createdAt: "desc" },
    });
    expect(row?.leadId).toBe(danaId);
  });
});
