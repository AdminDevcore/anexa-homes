import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * M1 FUNDING IS HELD AT EVERY DOOR A DEAL CAN BE MOVED THROUGH.
 *
 * The funding gate lived in `moveLeadStage` alone — the board and the deal
 * page. Every other writer of a deal's stage went around it: the lead form
 * (create and edit), the Summary card's quick edit, the canvassing map's
 * appointment booking, automations, and the paperwork-driven advance to
 * Contract Signed. Each is driven here the way a hand-rolled request would
 * drive it, with no UI in the loop. They all now reach ONE guard —
 * `pipeline/stage-guard.ts` — and `src/lib/__tests__/stage-moves-guarded.test.ts`
 * fails the build if a new stage writer appears that does not.
 *
 * Two pipelines:
 *
 *  - LIVE's ordering and keys, trimmed. The M1 stage is `partial_funding_26`
 *    (born "Partial Funding", renamed) — a guard matching a tidy `m1_funding`
 *    would pass a tidier fixture and leave production open.
 *
 *  - SKEWED: Appointment Set and Contract Signed sit PAST M1. Nobody should
 *    build that, but stage order is editable in Settings, and the automatic
 *    re-stages — an appointment date, paperwork arriving — are the moves nobody
 *    is watching. On a sane pipeline those paths can never reach the gate, so
 *    this is the only way to prove they are guarded rather than lucky.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Notifications and automations fire after a move; neither is under test and
// both reach for infrastructure this suite has none of.
vi.mock("@/server/modules/notifications/engine", () => ({ fireEvent: vi.fn() }));
vi.mock("@/server/modules/automations/engine", () => ({ runAutomations: vi.fn() }));
vi.mock("@/server/auth/vertical", () => ({ getActiveVertical: vi.fn(async () => "solar") }));

const { moveLeadStage, cancelLeadAction } = await import("@/server/modules/leads/actions");
const { createLeadAction, updateLeadAction, updateLeadPatchAction } = await import("@/server/modules/leads/manage");
const { moveStageAction } = await import("@/server/modules/automations/actions/move-stage");
const { convertKnockToAppointmentAction } = await import("@/server/modules/canvassing/actions");
const { advanceToContractSignedIfReady } = await import("@/server/modules/pipeline/contract-signed");
const { upsertSolarCommissionAction } = await import("@/server/modules/solar/cockpit-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const tag = `${process.pid}-${Date.now()}`;

/** Whichever door was used, the refusal names the gate. */
const FUNDING_REFUSAL = /M1 Funding/;
/** A wall-clock appointment, the shape the lead forms post. */
const APPOINTMENT = "2026-10-01T14:00";
const ROLES: Role[] = ["sales_rep", "accounting", "admin", "super_admin"];

type StagePlan = [key: string, name: string, position: number, isLost: boolean, milestone: "contract_signed" | null];

type Tenant = {
  companyId: string;
  stages: Record<string, string>;
  users: Partial<Record<Role, string>>;
  leadId: string;
  startKey: string;
};

let live: Tenant;
let skew: Tenant;

async function makeTenant(name: string, plan: StagePlan[], startKey: string): Promise<Tenant> {
  const company = await db.company.create({ data: { name: `${name} Solar`, slug: `m1-${name}-${tag}`.toLowerCase() } });
  const companyId = company.id;
  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar", isDefault: true } });
  const stages: Record<string, string> = {};
  for (const [key, stageName, position, isLost, milestone] of plan) {
    const s = await db.pipelineStage.create({
      data: { pipelineId: pipeline.id, key, name: stageName, position, isLost, milestone },
    });
    stages[key] = s.id;
  }
  const users: Partial<Record<Role, string>> = {};
  for (const role of ROLES) {
    const u = await db.user.create({
      data: {
        companyId, role, passwordHash: "x", firstName: role, lastName: name,
        email: `${role}-m1-${name}-${tag}@test.local`.toLowerCase(),
      },
    });
    users[role] = u.id;
  }
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stages[startKey],
      firstName: "Gate", lastName: name, assignedRepId: users.sales_rep,
    },
  });
  return { companyId, stages, users, leadId: lead.id, startKey };
}

function actAs(t: Tenant, role: Role) {
  session.requireUser.mockResolvedValue({
    userId: t.users[role]!,
    companyId: t.companyId,
    role,
    permissions: {},
    fullName: `${role} user`,
  });
}

const solar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

const keyOf = (t: Tenant, stageId: string | null) =>
  Object.entries(t.stages).find(([, id]) => id === stageId)?.[0] ?? null;

const stageKey = async (t: Tenant, leadId = t.leadId) =>
  keyOf(t, (await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { stageId: true } })).stageId);

/** The funding desk confirms M1 on this deal — the way past the gate for everybody else. */
async function certifyFunding(t: Tenant) {
  actAs(t, "accounting");
  await solar(() => upsertSolarCommissionAction({ leadId: t.leadId, amountCents: 500_000, paid: true }));
  const milestone = await db.solarMilestone.findUnique({
    where: { leadId_payee_sequence: { leadId: t.leadId, payee: "rep", sequence: 1 } },
    select: { paidAt: true },
  });
  expect(milestone?.paidAt).toBeTruthy();
}

/** Both Contract Signed documents on file: the customer's signature and the lender's marked contract. */
async function contractPaperworkOnFile(t: Tenant) {
  await db.solarProposal.create({
    data: { companyId: t.companyId, leadId: t.leadId, version: 1, status: "signed", signedAt: new Date(), snapshot: {} as never },
  });
  await db.fileAsset.create({
    data: {
      companyId: t.companyId, leadId: t.leadId, kind: "document", name: "Amos Signed Contract.pdf", category: "contract",
      storageKey: `test/${randomBytes(8).toString("hex")}.pdf`, mimeType: "application/pdf", size: 10,
      uploadedById: t.users.admin, documentType: "signed_lender_contract",
    },
  });
}

beforeAll(async () => {
  live = await makeTenant(
    "Live",
    [
      ["qualified", "Qualified", 1, false, null],
      ["installed", "Install Complete", 15, false, null],
      ["partial_funding_26", "M1 Funding", 16, false, null],
      ["inspection_complete_22", "Inspection Complete", 19, false, null],
      ["cancelled_27", "Cancelled", 27, true, null],
    ],
    "installed"
  );
  skew = await makeTenant(
    "Skew",
    [
      ["new_lead", "New Lead", 0, false, null],
      ["m1_funding", "M1 Funding", 1, false, null],
      ["appointment_set", "Appointment Set", 2, false, null],
      ["contract_signed_hold_2", "Contract Signed / Hold", 3, false, "contract_signed"],
      ["cancelled", "Cancelled", 9, true, null],
    ],
    "new_lead"
  );
});

beforeEach(async () => {
  for (const t of [live, skew]) {
    await db.solarMilestone.deleteMany({ where: { leadId: t.leadId } });
    await db.solarProposal.deleteMany({ where: { companyId: t.companyId } });
    await db.fileAsset.deleteMany({ where: { companyId: t.companyId } });
    await db.knock.deleteMany({ where: { companyId: t.companyId } });
    await db.lead.update({
      where: { id: t.leadId },
      data: { stageId: t.stages[t.startKey], status: "open", appointmentAt: null },
    });
  }
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: { in: [live.companyId, skew.companyId] } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. The board and the deal page
// ---------------------------------------------------------------------------

describe("the board and the deal page — moveLeadStage", () => {
  it("a rep cannot put an unfunded deal on M1 Funding, or past it", async () => {
    actAs(live, "sales_rep");
    for (const key of ["partial_funding_26", "inspection_complete_22"]) {
      const res = await solar(() => moveLeadStage({ leadId: live.leadId, stageId: live.stages[key] }));
      expect(res.ok).toBe(false);
      expect("error" in res && res.error).toMatch(FUNDING_REFUSAL);
    }
    expect(await stageKey(live)).toBe("installed");
  });

  // Accounting certifies funding too (see certifyFunding) but holds no Lead
  // update at all, so the board refuses it before either rule is asked.
  it.each(["admin", "super_admin"] as Role[])("%s — who may certify funding — may", async (role) => {
    actAs(live, role);
    expect((await solar(() => moveLeadStage({ leadId: live.leadId, stageId: live.stages.partial_funding_26 }))).ok).toBe(true);
    expect(await stageKey(live)).toBe("partial_funding_26");
  });

  it("once M1 is certified, the rep carries the job on", async () => {
    await certifyFunding(live);
    actAs(live, "sales_rep");
    expect((await solar(() => moveLeadStage({ leadId: live.leadId, stageId: live.stages.inspection_complete_22 }))).ok).toBe(true);
    expect(await stageKey(live)).toBe("inspection_complete_22");
  });

  it("cancelling is never a funding claim", async () => {
    actAs(live, "sales_rep");
    expect((await solar(() => cancelLeadAction({ leadId: live.leadId, reason: "Customer walked away" }))).ok).toBe(true);
    expect(await stageKey(live)).toBe("cancelled_27");
  });
});

// ---------------------------------------------------------------------------
// 2. The lead form, with a stage picked on purpose
// ---------------------------------------------------------------------------

describe("the lead form — a stage picked on create or edit", () => {
  it("a rep cannot pick M1 Funding on the edit form", async () => {
    actAs(live, "sales_rep");
    const res = await solar(() =>
      updateLeadAction(live.leadId, { firstName: "Gate", lastName: "Live", stageId: live.stages.partial_funding_26 } as never)
    );
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(FUNDING_REFUSAL);
    expect(await stageKey(live)).toBe("installed");
  });

  it("a rep cannot create a deal already standing on M1 Funding — and nothing is created", async () => {
    actAs(live, "sales_rep");
    const lastName = `Born-funded-${tag}`;
    const res = await solar(() =>
      createLeadAction({ firstName: "New", lastName, stageId: live.stages.partial_funding_26 } as never)
    );
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(FUNDING_REFUSAL);
    expect(await db.lead.count({ where: { companyId: live.companyId, lastName } })).toBe(0);
  });

  it("the funding desk can, on both", async () => {
    actAs(live, "admin");
    const lastName = `Desk-created-${tag}`;
    const created = await solar(() =>
      createLeadAction({ firstName: "New", lastName, stageId: live.stages.partial_funding_26 } as never)
    );
    expect(created.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { companyId: live.companyId, lastName }, select: { id: true } });
    expect(await stageKey(live, lead.id)).toBe("partial_funding_26");

    const edited = await solar(() =>
      updateLeadAction(live.leadId, { firstName: "Gate", lastName: "Live", stageId: live.stages.partial_funding_26 } as never)
    );
    expect(edited.ok).toBe(true);
    expect(await stageKey(live)).toBe("partial_funding_26");
  });
});

// ---------------------------------------------------------------------------
// 3. Automatic re-stages — the appointment date, from every form that sets one
// ---------------------------------------------------------------------------

describe("automatic re-stages on a pipeline whose front sits past M1", () => {
  it("creating a deal with an appointment starts it at the front, not past the gate", async () => {
    actAs(skew, "sales_rep");
    const lastName = `Appt-new-${tag}`;
    const res = await solar(() => createLeadAction({ firstName: "Skew", lastName, appointmentAt: APPOINTMENT } as never));
    expect(res.ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { companyId: skew.companyId, lastName }, select: { id: true } });
    expect(await stageKey(skew, lead.id)).toBe("new_lead");
  });

  it("the same booking by the funding desk lands where the pipeline puts it — the guard judges the actor", async () => {
    actAs(skew, "admin");
    const lastName = `Appt-desk-${tag}`;
    expect((await solar(() => createLeadAction({ firstName: "Skew", lastName, appointmentAt: APPOINTMENT } as never))).ok).toBe(true);
    const lead = await db.lead.findFirstOrThrow({ where: { companyId: skew.companyId, lastName }, select: { id: true } });
    expect(await stageKey(skew, lead.id)).toBe("appointment_set");
  });

  it("the edit form's appointment date does not carry the deal past the gate — and the save still succeeds", async () => {
    actAs(skew, "sales_rep");
    const res = await solar(() =>
      updateLeadAction(skew.leadId, {
        firstName: "Gate", lastName: "Skew", stageId: skew.stages.new_lead, appointmentAt: APPOINTMENT,
      } as never)
    );
    expect(res.ok).toBe(true);
    expect(await stageKey(skew)).toBe("new_lead");
  });

  it("the Summary card's quick edit does not either", async () => {
    actAs(skew, "sales_rep");
    expect((await solar(() => updateLeadPatchAction(skew.leadId, { appointmentAt: APPOINTMENT }))).ok).toBe(true);
    expect(await stageKey(skew)).toBe("new_lead");
  });

  it("booking from the canvassing map does not either", async () => {
    actAs(skew, "sales_rep");
    const knock = await db.knock.create({
      data: { companyId: skew.companyId, vertical: "solar", lat: 30.27, lng: -97.74, repId: skew.users.sales_rep, leadId: skew.leadId },
    });
    const res = await solar(() =>
      convertKnockToAppointmentAction({ knockId: knock.id, appointmentAt: "2026-10-01T19:00:00.000Z" })
    );
    expect(res.ok).toBe(true);
    expect(await stageKey(skew)).toBe("new_lead");
  });
});

// ---------------------------------------------------------------------------
// 4. Automations
// ---------------------------------------------------------------------------

describe("automations — move_stage", () => {
  const run = (stageId: string) =>
    solar(() =>
      moveStageAction.run({ companyId: live.companyId, vertical: "solar", leadId: live.leadId, config: { stageId }, depth: 0 })
    );

  it("a rule cannot put an unfunded deal on M1 Funding — nobody behind a rule can certify funding", async () => {
    const res = await run(live.stages.partial_funding_26);
    expect(res.ok).toBe(false);
    expect(res.detail).toMatch(FUNDING_REFUSAL);
    expect(await stageKey(live)).toBe("installed");
  });

  it("once M1 is certified, the rule moves it", async () => {
    await certifyFunding(live);
    expect((await run(live.stages.inspection_complete_22)).ok).toBe(true);
    expect(await stageKey(live)).toBe("inspection_complete_22");
  });
});

// ---------------------------------------------------------------------------
// 5. Paperwork arriving
// ---------------------------------------------------------------------------

describe("paperwork arriving — advanceToContractSignedIfReady", () => {
  it("both documents on file do not carry an unfunded deal past M1 on their own", async () => {
    await contractPaperworkOnFile(skew);
    const res = await solar(() => advanceToContractSignedIfReady({ companyId: skew.companyId, leadId: skew.leadId, via: "document" }));
    expect(res.advanced).toBe(false);
    expect(await stageKey(skew)).toBe("new_lead");
  });

  it("once M1 is certified, the paperwork advances it as before", async () => {
    await contractPaperworkOnFile(skew);
    await certifyFunding(skew);
    const res = await solar(() => advanceToContractSignedIfReady({ companyId: skew.companyId, leadId: skew.leadId, via: "document" }));
    expect(res.advanced).toBe(true);
    expect(await stageKey(skew)).toBe("contract_signed_hold_2");
  });
});
