import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A rep cannot WRITE to another rep's solar deal.
 *
 * WHY THIS IS NOT A PLAYWRIGHT TEST. The browser half of this boundary — that
 * rep B is 404'd on every page under rep A's deal — lives in e2e/row-scope.spec.ts.
 * This is the other half, and the one that actually matters: every export of a
 * `"use server"` module is a public RPC endpoint, reachable whether or not any
 * page will render for you. Playwright cannot invoke one faithfully, because
 * Next derives action ids from the build and the browser never names them.
 * Calling the exported function directly, against a real database, is the
 * honest reproduction of what an attacker has.
 *
 * WHAT MAKES IT A REAL TEST. `can()` is NOT mocked. Both users are `sales_rep`,
 * so both hold `Lead:update` and `Proposal:update` and the matrix waves both
 * through — exactly as it did when this was broken. The only thing that can
 * refuse rep B is `leadAccessible`. And every case is paired: the SAME payload
 * is run as rep A first and must SUCCEED, so a refusal cannot come from a
 * validation error, a missing fixture or a typo in the input.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

/** Who `requireUser()` answers with on the next call. */
let current: { userId: string; companyId: string; role: string; permissions: Record<string, unknown> };

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { runInVertical } = await import("@/server/vertical/context");
const { setSolarCreditClaimsAction, setSolarSystemTypeAction } = await import("../actions");
const { setProposalComparisonAction } = await import("../proposal-actions");

let companyId = "";
let repA = "";
let repB = "";
let leadId = "";
let proposalId = "";

const asUser = (userId: string) => {
  current = { userId, companyId, role: "sales_rep", permissions: {} };
};

const solar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Row Scope Co", slug: `rs-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;

  const mk = async (email: string, first: string) =>
    (
      await db.user.create({
        data: {
          companyId,
          email: `${email}-${process.pid}@rowscope.test`,
          firstName: first,
          lastName: "Rep",
          role: "sales_rep",
          status: "active",
          passwordHash: "x",
          verticals: ["roofing", "solar"],
        },
      })
    ).id;
  repA = await mk("repa", "Ada");
  repB = await mk("repb", "Bea");

  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId: pipe.id,
      stageId: stage.id,
      firstName: "Owned",
      lastName: "ByAda",
      // Ada's deal on both arms of the sales_rep branch in listScope.
      assignedRepId: repA,
      createdById: repA,
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarFinance.deleteMany({ where: { companyId } });
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarProposal.deleteMany({ where: { companyId } });

  await db.solarFinance.create({
    data: { companyId, leadId, vertical: "solar", claimItc: false },
  });
  await db.solarDesign.create({
    data: { companyId, leadId, vertical: "solar", systemType: "pv" },
  });
  const p = await db.solarProposal.create({
    data: {
      companyId,
      leadId,
      vertical: "solar",
      version: 1,
      status: "generated",
      snapshot: { schemaVersion: 4 },
      showComparison: false,
    },
  });
  proposalId = p.id;
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("solar writes are scoped to the rep who owns the deal", () => {
  it("credit claims: Ada may set them, Bea is refused and nothing moves", async () => {
    const payload = {
      leadId,
      claimItc: true,
      claimEnergyCommunity: false,
      claimDomesticContent: false,
    };

    asUser(repA);
    expect(await solar(() => setSolarCreditClaimsAction(payload))).toMatchObject({ ok: true });
    expect((await db.solarFinance.findFirst({ where: { leadId } }))?.claimItc).toBe(true);

    // Put it back, so the refusal below is measured against a known state.
    await db.solarFinance.updateMany({ where: { leadId }, data: { claimItc: false } });

    asUser(repB);
    expect(await solar(() => setSolarCreditClaimsAction(payload))).toMatchObject({
      ok: false,
      error: "Deal not found.",
    });
    expect((await db.solarFinance.findFirst({ where: { leadId } }))?.claimItc).toBe(false);
  });

  it("system type: Ada may change what the deal sells, Bea may not", async () => {
    const payload = { leadId, systemType: "pv_storage" as const };

    asUser(repA);
    expect(await solar(() => setSolarSystemTypeAction(payload))).toMatchObject({ ok: true });

    await db.solarDesign.updateMany({ where: { leadId }, data: { systemType: "pv" } });

    asUser(repB);
    expect(await solar(() => setSolarSystemTypeAction(payload))).toMatchObject({
      ok: false,
      error: "Deal not found.",
    });
    expect((await db.solarDesign.findFirst({ where: { leadId } }))?.systemType).toBe("pv");
  });

  it("a proposal-keyed action resolves the deal behind the proposal", async () => {
    // The id here names a PROPOSAL, not a deal, which is why this one was easy
    // to miss: the row it loads is tenant-correct and still none of Bea's
    // business. The refusal says "Proposal not found." rather than admitting
    // the row exists.
    asUser(repA);
    expect(await solar(() => setProposalComparisonAction(proposalId, true))).toMatchObject({
      ok: true,
    });

    await db.solarProposal.update({ where: { id: proposalId }, data: { showComparison: false } });

    asUser(repB);
    expect(await solar(() => setProposalComparisonAction(proposalId, true))).toMatchObject({
      ok: false,
      error: "Proposal not found.",
    });
    expect((await db.solarProposal.findUnique({ where: { id: proposalId } }))?.showComparison).toBe(
      false
    );
  });
});
