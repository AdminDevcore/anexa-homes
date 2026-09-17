import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient, type Prisma, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { emptyDetail, readDetail } from "../detail";
import type { ChangeRecord } from "../types";

/**
 * The two states an applied run must never be left in: a note carrying raw
 * driver text into a jsonb column, and a row that says "applied by this
 * person" while its own record says nothing happened.
 *
 * `moveDeal` and `runStageEnteredAutomations` are the only things stood in for,
 * and only when a test asks them to throw — otherwise the real ones run and the
 * deal really moves. Nothing else can put a Prisma-shaped error, or a failure
 * in the window between the claim and the write-down, in front of the action
 * from outside it.
 */

const seam = vi.hoisted(() => ({ moveError: null as unknown, automationError: null as unknown }));

vi.mock("../apply-changes", async (importOriginal) => {
  const real = await importOriginal<typeof import("../apply-changes")>();
  return {
    ...real,
    moveDeal: async (...args: Parameters<typeof real.moveDeal>) => {
      if (seam.moveError) throw seam.moveError;
      return real.moveDeal(...args);
    },
    runStageEnteredAutomations: async (...args: Parameters<typeof real.runStageEnteredAutomations>) => {
      if (seam.automationError) throw seam.automationError;
      return real.runStageEnteredAutomations(...args);
    },
  };
});

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

vi.mock("@/server/auth/session", () => ({ requireUser: async () => current, getSessionUser: async () => current }));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (fn: () => unknown) => void fn,
}));

const actions = await import("../actions");

/** The note the claim writes against every change it is about to attempt. */
const APPLYING = "Applying: a person approved this, and what happened is not recorded yet.";

let companyId = "";
let pipelineId = "";
let adminId = "";
let leadId = "";
let agentId = "";
let runId = "";
const stage: Record<string, string> = {};

beforeAll(async () => {
  companyId = (await db.company.create({ data: { name: "Apply Errors Co", slug: `agent-apply-errors-${process.pid}-${Date.now()}` } })).id;
  adminId = (
    await db.user.create({
      data: {
        companyId,
        email: `admin-${process.pid}@agent-apply-errors.test`,
        firstName: "Ada",
        lastName: "Admin",
        role: "admin",
        status: "active",
        passwordHash: "x",
        permissions: {},
        verticals: ["roofing"],
      },
    })
  ).id;
  pipelineId = (await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } })).id;
  for (const [position, key] of ["from", "main"].entries()) {
    stage[key] = (
      await db.pipelineStage.create({ data: { pipelineId, key, name: key[0].toUpperCase() + key.slice(1), position } })
    ).id;
  }
  leadId = (
    await db.lead.create({ data: { companyId, vertical: "roofing", pipelineId, stageId: stage.from, firstName: "Maria", lastName: "Lopez", address: "12 Elm St" } })
  ).id;
  agentId = (await db.agent.create({ data: { companyId, name: "NTP Poller", handlerKey: "system.hello", department: "permit", vertical: "roofing" } })).id;
});

beforeEach(async () => {
  seam.moveError = null;
  seam.automationError = null;
  current = { userId: adminId, companyId, role: "admin", permissions: {}, verticals: ["roofing"], fullName: "Ada Admin" };

  await db.agentRun.deleteMany({ where: { companyId } });
  await db.leadStageEvent.deleteMany({ where: { leadId } });
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.lead.update({ where: { id: leadId }, data: { stageId: stage.from } });

  const change: ChangeRecord = {
    type: "move_stage",
    leadId,
    toStageKey: "main",
    reason: "Portal shows NTP approved",
    dealLabel: "Maria Lopez · 12 Elm St",
    fromStage: { id: stage.from, key: "from", name: "From" },
    toStage: { id: stage.main, key: "main", name: "Main", position: 1, isActionRequired: false, defaultBlocker: null, stageType: "internally_owned" },
    outcome: "held",
    note: "Held: this agent is gated and Main is not an Action Required stage.",
  };
  runId = (
    await db.agentRun.create({
      data: {
        companyId,
        agentId,
        vertical: "roofing",
        trigger: "scheduled",
        status: "needs_human",
        summary: "NTP approved in the portal",
        detail: { ...emptyDetail({ handlerKey: "system.hello", config: {}, requiresHumanGate: true }), changes: [change] } as unknown as Prisma.InputJsonValue,
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
  await db.pipelineStage.deleteMany({ where: { pipelineId } });
  await db.pipeline.deleteMany({ where: { companyId } });
  await db.user.deleteMany({ where: { companyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

/** The note a change carries after an apply whose move threw. */
async function noteAfterApply(): Promise<{ note: string; resolutionNote: string | null }> {
  expect(await actions.resolveAgentRunAction({ runId, resolution: "applied" })).toEqual({ ok: true, failed: 1 });
  const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
  return { note: readDetail(run.detail).resolution?.changes[0]?.note ?? "", resolutionNote: run.resolutionNote };
}

/** What a person is told when the driver, and not one of our own guards, refused the move. */
const DRIVER_NOTE = "Not applied: the deal could not be updated. Try again, or open the deal.";

describe("a move that throws", () => {
  it("records one short, clean line — a NUL byte in the driver's message must not fail the write that records it", async () => {
    // What a Prisma failure really looks like: a first line, a NUL the jsonb
    // column would reject outright, an argument dump, and a stack.
    seam.moveError = new Error(
      `Invalid \`prisma.lead.updateMany()\` invocation:\u0000 ${"x".repeat(900)}\n\n  argument dump\n  at moveDeal (/app/src/server/modules/agents/apply-changes.ts:142:31)`
    );

    const { note, resolutionNote } = await noteAfterApply();
    expect(note).not.toContain("\u0000");
    expect(note).not.toContain("at moveDeal");
    expect(note).not.toContain("argument dump");
    expect(note.length).toBeLessThanOrEqual(500);
    // The deal never moved, and the run says so without anyone opening it.
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.from);
    expect(resolutionNote).toBe("Applied 0 of 1 change.");
  });

  /**
   * The note goes into `detail`, and `ChangeList` renders it word for word to
   * whoever opens the run. Prisma's own first line names one of our tables and
   * a client method, tells the reader nothing they can act on, and puts a piece
   * of the schema on a portal page. It is substituted, never forwarded.
   */
  it("does not put Prisma's own wording in front of a person", async () => {
    seam.moveError = new Error(
      `Invalid \`prisma.lead.updateMany()\` invocation:\n\n  argument dump\n  at moveDeal (/app/src/server/modules/agents/apply-changes.ts:142:31)`
    );

    const { note } = await noteAfterApply();
    expect(note).toBe(DRIVER_NOTE);
    expect(note).not.toContain("Invalid `prisma.");
    expect(note).not.toContain("lead.updateMany");
  });

  /**
   * A real PrismaClientKnownRequestError opens with a NEWLINE, so the literal
   * first line of its message is empty. Reading only the first line both misses
   * the wording to substitute AND leaves the person a note that says "Not
   * applied:" and then nothing at all.
   */
  it("substitutes Prisma's wording even when the message opens with a blank line", async () => {
    seam.moveError = new Error(`\nInvalid \`prisma.activityLog.create()\` invocation:\n\nUnique constraint failed on the fields: (\`id\`)`);

    const { note } = await noteAfterApply();
    expect(note).toBe(DRIVER_NOTE);
    expect(note).not.toContain("Invalid `prisma.");
  });

  /**
   * The other half of the rule. `moveDeal`'s own refusal is written FOR the
   * person reading the run — it is the commonest failure on this path, and the
   * one sentence here that explains itself — so it must still arrive verbatim.
   * Substituting it too would trade an unreadable note for one that says less
   * than the truth. `actions.itest.ts` proves the same sentence end to end,
   * with a real second move that a real first move made impossible; this states
   * the rule where the rule now lives.
   */
  it("still passes our own thrown sentence through verbatim", async () => {
    seam.moveError = new Error("This deal has moved since the agent looked at it; nothing was changed.");

    const { note } = await noteAfterApply();
    expect(note).toBe("Not applied: This deal has moved since the agent looked at it; nothing was changed.");
  });
});

describe("a failure between the claim and the write-down", () => {
  it("leaves a record that names the person and says the moves were still in flight", async () => {
    // A throw after the deal has moved and before the outcome is written: the
    // one window whose state nothing can reconstruct afterwards.
    seam.automationError = new Error("pool exhausted");

    await expect(actions.resolveAgentRunAction({ runId, resolution: "applied" })).rejects.toThrow("pool exhausted");

    // The deal really did move.
    expect((await db.lead.findUniqueOrThrow({ where: { id: leadId } })).stageId).toBe(stage.main);

    const run = await db.agentRun.findUniqueOrThrow({ where: { id: runId } });
    expect(run).toMatchObject({ resolution: "applied", resolvedById: adminId });
    const resolution = readDetail(run.detail).resolution;
    expect(resolution).not.toBeNull();
    expect(resolution?.byUserId).toBe(adminId);
    expect(resolution?.changes).toHaveLength(1);
    expect(resolution?.changes[0]).toMatchObject({ leadId, outcome: "held", note: APPLYING });
  });
});
