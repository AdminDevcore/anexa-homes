import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * A REP CANNOT MAKE THEIR OWN DEAL COMMISSION-READY.
 *
 * `generateCommissionsAction` releases commission on a solar deal when two
 * facts stand together:
 *
 *   1. the deal's stage is at or past M1 Funding
 *   2. `SolarMilestone(payee: "rep", sequence: 1).paidAt` is set
 *
 * Both were ordinary `Lead:update` writes, which every `sales_rep` holds on
 * their own deals. This suite drives the SERVER ACTIONS the way a hand-rolled
 * request would — no UI in the loop — because hiding a control is not a
 * control.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// The stage move fires notifications and automations at the end; neither is
// under test and both reach for infrastructure this suite has none of.
vi.mock("@/server/modules/notifications/engine", () => ({ fireEvent: vi.fn() }));
vi.mock("@/server/modules/automations/engine", () => ({ runAutomations: vi.fn() }));
vi.mock("@/server/auth/vertical", () => ({ getActiveVertical: vi.fn(async () => "solar") }));

const { upsertSolarCommissionAction } = await import("@/server/modules/solar/cockpit-actions");
const { moveLeadStage } = await import("@/server/modules/leads/actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let repId: string;
const stages: Record<string, string> = {};
/** A real row per role — `ActivityLog.actorId` is a foreign key. */
const users: Partial<Record<Role, string>> = {};

/** Act as this role. Row scope still applies underneath — see `listScope`. */
function actAs(role: Role) {
  session.requireUser.mockResolvedValue({
    userId: users[role]!,
    companyId,
    role,
    permissions: {},
    fullName: `${role} user`,
  });
}

const setCommission = (input: { amountCents?: number; paid?: boolean }) =>
  runInVertical("solar", () =>
    upsertSolarCommissionAction({ leadId, amountCents: input.amountCents ?? 500_000, ...input })
  );

const moveTo = (key: string) =>
  runInVertical("solar", () => moveLeadStage({ leadId, stageId: stages[key] }));

const milestone = () =>
  db.solarMilestone.findUnique({
    where: { leadId_payee_sequence: { leadId, payee: "rep", sequence: 1 } },
  });

const currentStage = async () =>
  (await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stageId: true } })).stageId;

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Funding Gate Co", slug: `fg-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  /**
   * LIVE's own ordering, trimmed to the stages this suite moves between — and
   * with LIVE's own key for the funding stage. It was created as "Partial
   * Funding" and renamed to "M1 Funding", so the key still says
   * `partial_funding_26`. A guard matching a tidy `m1_funding` would pass this
   * suite and leave the gate open in production.
   */
  const plan: [string, string, number, boolean][] = [
    ["qualified", "Qualified", 1, false],
    ["installed", "Install Complete", 15, false],
    ["partial_funding_26", "M1 Funding", 16, false],
    ["inspection_complete_22", "Inspection Complete", 19, false],
    ["cancelled_27", "Cancelled", 27, true],
  ];
  for (const [key, name, position, isLost] of plan) {
    const s = await db.pipelineStage.create({
      data: { pipelineId: pipeline.id, key, name, position, isLost },
    });
    stages[key] = s.id;
  }

  for (const role of [
    "sales_rep", "canvasser", "manager", "accounting", "admin", "super_admin",
  ] as Role[]) {
    const u = await db.user.create({
      data: {
        companyId,
        email: `${role}-fg-${process.pid}@test.local`,
        firstName: role,
        lastName: "User",
        role,
        passwordHash: "x",
      },
    });
    users[role] = u.id;
  }
  repId = users.sales_rep!;

  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId: pipeline.id,
      stageId: stages.qualified,
      firstName: "Gate",
      lastName: "Test",
      assignedRepId: repId,
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarMilestone.deleteMany({ where: { leadId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.update({ where: { id: leadId }, data: { stageId: stages.qualified } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the rep milestone is a financial event, not a Lead:update", () => {
  it("REFUSES a sales rep marking their own deal funded", async () => {
    actAs("sales_rep");
    const res = await setCommission({ paid: true });
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/funding desk/i);
    expect(await milestone()).toBeNull();
  });

  it("REFUSES a canvasser and a manager too", async () => {
    for (const role of ["canvasser", "manager"] as Role[]) {
      actAs(role);
      const res = await setCommission({ paid: true });
      expect(res.ok, `${role} must not certify funding`).toBe(false);
      expect(await milestone()).toBeNull();
    }
  });

  it("lets accounting — the funding desk — record it", async () => {
    actAs("accounting");
    const res = await setCommission({ paid: true });
    expect(res.ok).toBe(true);
    expect((await milestone())?.paidAt).toBeInstanceOf(Date);
  });

  it("lets an admin and a super admin record it", async () => {
    for (const role of ["admin", "super_admin"] as Role[]) {
      await db.solarMilestone.deleteMany({ where: { leadId } });
      actAs(role);
      expect((await setCommission({ paid: true })).ok).toBe(true);
      expect((await milestone())?.paidAt).toBeInstanceOf(Date);
    }
  });

  it("still lets a rep keep their own FORECAST up to date", async () => {
    // The amount, the trigger and the expected date are the rep's to maintain.
    // Nothing pays out of them; only `paidAt` releases money.
    actAs("sales_rep");
    const res = await setCommission({ amountCents: 812_500 });
    expect(res.ok).toBe(true);
    const row = await milestone();
    expect(row?.amountCents).toBe(812_500);
    expect(row?.paidAt).toBeNull();
  });

  it("a rep's later save cannot silently UN-FUND a deal the desk confirmed", async () => {
    // `paidAt: d.paid ? new Date() : null` cleared the stamp on every save that
    // did not resend the flag, so a rep editing the amount reversed a funding
    // confirmation and the commission quietly stopped generating.
    actAs("accounting");
    await setCommission({ paid: true });
    const confirmedAt = (await milestone())!.paidAt;

    actAs("sales_rep");
    const res = await setCommission({ amountCents: 999_999 });
    expect(res.ok).toBe(true);
    const after = await milestone();
    expect(after?.amountCents).toBe(999_999); // the forecast moved…
    expect(after?.paidAt).toEqual(confirmedAt); // …and the funding did not
  });

  it("REFUSES a rep explicitly trying to un-fund it", async () => {
    actAs("accounting");
    await setCommission({ paid: true });

    actAs("sales_rep");
    const res = await setCommission({ paid: false });
    expect(res.ok).toBe(false);
    expect((await milestone())?.paidAt).toBeInstanceOf(Date);
  });

  it("records who certified funding, and who withdrew it", async () => {
    actAs("accounting");
    await setCommission({ paid: true });
    const confirmed = await db.activityLog.findFirst({
      where: { leadId, type: "payment" },
      orderBy: { createdAt: "desc" },
    });
    expect(confirmed?.message).toMatch(/confirmed M1 funding/i);
    expect(confirmed?.actorId).toBe(users.accounting);

    await setCommission({ paid: false });
    const withdrawn = await db.activityLog.findFirst({
      where: { leadId, type: "payment" },
      orderBy: { createdAt: "desc" },
    });
    expect(withdrawn?.message).toMatch(/withdrew the M1 funding/i);
  });
});

describe("the pipeline stage cannot be pushed past the funding line either", () => {
  it("REFUSES a rep moving their own deal to M1 Funding", async () => {
    actAs("sales_rep");
    const res = await moveTo("partial_funding_26");
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/M1 Funding/i);
    expect(await currentStage()).toBe(stages.qualified);
  });

  it("REFUSES a rep jumping clean over it to a later stage", async () => {
    // The gate is positional — a deal at Inspection Complete is already
    // eligible — so skipping the funding stage must not skip the check.
    actAs("sales_rep");
    const res = await moveTo("inspection_complete_22");
    expect(res.ok).toBe(false);
    expect(await currentStage()).toBe(stages.qualified);
  });

  it("lets a rep move freely BEFORE the line", async () => {
    actAs("sales_rep");
    expect((await moveTo("installed")).ok).toBe(true);
    expect(await currentStage()).toBe(stages.installed);
  });

  it("lets a rep CANCEL their own deal, wherever Cancelled sits", async () => {
    // Cancelled is at position 27 — past the funding stage — so a purely
    // positional rule would trap a dead deal in the pipeline.
    actAs("sales_rep");
    const res = await moveTo("cancelled_27");
    expect(res.ok).toBe(true);
    expect(await currentStage()).toBe(stages.cancelled_27);
  });

  it("lets an admin move it across", async () => {
    actAs("admin");
    expect((await moveTo("partial_funding_26")).ok).toBe(true);
    expect(await currentStage()).toBe(stages.partial_funding_26);
  });

  it("accounting confirms funding but does not work the board", async () => {
    // Deliberate, and worth pinning: `accounting` holds no Lead grant at all,
    // so the funding desk records M1 on the deal and somebody with the board
    // moves the card. Two people, two acts — which is the point.
    actAs("accounting");
    expect((await setCommission({ paid: true })).ok).toBe(true);
    const res = await moveTo("partial_funding_26");
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/not allowed/i);
  });

  it("opens the board again once funding IS recorded", async () => {
    // The desk records M1 once; from then on anybody working the board carries
    // the job through Inspection and PTO normally.
    actAs("accounting");
    await setCommission({ paid: true });

    actAs("sales_rep");
    const res = await moveTo("inspection_complete_22");
    expect(res.ok).toBe(true);
    expect(await currentStage()).toBe(stages.inspection_complete_22);
  });

  it("does not gate a ROOFING deal — its line is not about cash arriving", async () => {
    const roofPipe = await db.pipeline.create({
      data: { companyId, name: "Roofing", vertical: "roofing" },
    });
    const roofStage = await db.pipelineStage.create({
      data: { pipelineId: roofPipe.id, key: "paid", name: "Paid", position: 20 },
    });
    const roofLead = await db.lead.create({
      data: {
        companyId,
        vertical: "roofing",
        pipelineId: roofPipe.id,
        stageId: roofStage.id,
        firstName: "Roof",
        lastName: "Deal",
        assignedRepId: repId,
      },
    });

    actAs("sales_rep");
    const res = await runInVertical("roofing", () =>
      moveLeadStage({ leadId: roofLead.id, stageId: roofStage.id })
    );
    expect(res.ok).toBe(true);
  });
});

describe("the two conditions together are what release commission", () => {
  it("a rep acting alone can satisfy NEITHER, so nothing becomes payable", async () => {
    // The whole defect in one assertion: before the fix a rep could set both.
    actAs("sales_rep");
    expect((await moveTo("partial_funding_26")).ok).toBe(false);
    expect((await setCommission({ paid: true })).ok).toBe(false);

    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stageId).toBe(stages.qualified);
    expect(await milestone()).toBeNull();
  });
});
