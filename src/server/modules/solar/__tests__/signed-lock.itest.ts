import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * A SIGNED CONTRACT'S ECONOMICS ARE A RECORD, NOT A DRAFT.
 *
 * Everything here drives the SERVER ACTIONS directly, the way a hand-rolled
 * request would, because the defect was never that a control was visible — it
 * was that nothing behind the control said no.
 *
 * The sharp end: `SolarDealComp` freezes the pay RATES at signing, but a
 * redline is measured against `baseKeptCents`, which payroll recomputes live
 * from `SolarFinance`. Raising the price after signature raised the rep's own
 * commission on their own deal.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const { saveSolarFinanceAction, setSolarDealLenderAction, setSolarCreditClaimsAction } =
  await import("../actions");
const { setSolarDesignEquipmentAction } = await import("../equipment-actions");
const { saveSolarLayoutAction } = await import("../layout-actions");
const { repriceProposalAction } = await import("../proposal-reprice-actions");
const { recomputeDealMoney } = await import("../deal-money");
const { addDealAdderAction } = await import("../adder-actions");
const { dealSignedAt } = await import("../signed-lock");
const { unlockSignedContractAction, relockSignedContractAction } =
  await import("../unlock-actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let moduleId: string;
let batteryId: string;
let lenderA: string;
let lenderB: string;
const users: Partial<Record<Role, string>> = {};

function actAs(role: Role) {
  session.requireUser.mockResolvedValue({
    userId: users[role]!,
    companyId,
    role,
    permissions: {},
    fullName: `${role} user`,
  });
}

const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

/** Put a signature on the deal, the way the customer's own link does. */
async function sign() {
  await db.solarProposal.updateMany({
    where: { leadId },
    data: { status: "signed", signedAt: new Date(), signerName: "H. Owner" },
  });
}
async function unsign() {
  await db.solarProposal.updateMany({ where: { leadId }, data: { status: "generated", signedAt: null } });
}

const finance = () => db.solarFinance.findUnique({ where: { leadId } });
const design = () => db.solarDesign.findUnique({ where: { leadId } });

const savePrice = (grossPpwCents: number) =>
  inSolar(() =>
    saveSolarFinanceAction({
      leadId,
      product: "loan",
      grossPpwCents,
      dealerFeePct: 18,
    } as Parameters<typeof saveSolarFinanceAction>[0])
  );

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Signed Lock Co", slug: `lock-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;

  for (const role of ["sales_rep", "manager", "admin", "super_admin"] as Role[]) {
    const u = await db.user.create({
      data: {
        companyId,
        email: `${role}-lock-${process.pid}@test.local`,
        firstName: role,
        lastName: "U",
        role,
        passwordHash: "x",
      },
      select: { id: true },
    });
    users[role] = u.id;
  }

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "signed", name: "Contract Signed", position: 5 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Locked", lastName: "Deal", assignedRepId: users.sales_rep!,
    },
  });
  leadId = lead.id;

  const mod = await db.solarEquipment.create({
    data: { companyId, kind: "module", manufacturer: "Qcells", model: "Q.PEAK", ratingW: 400, priceCents: 0 },
    select: { id: true },
  });
  moduleId = mod.id;
  const batt = await db.solarEquipment.create({
    data: { companyId, kind: "battery", manufacturer: "Tesla", model: "PW3", ratingW: 13500, priceCents: 1_400_000 },
    select: { id: true },
  });
  batteryId = batt.id;

  lenderA = (await db.solarLender.create({ data: { companyId, name: "Lender A" }, select: { id: true } })).id;
  lenderB = (await db.solarLender.create({ data: { companyId, name: "Lender B" }, select: { id: true } })).id;
});

beforeEach(async () => {
  await db.activityLog.deleteMany({ where: { companyId } });
  await db.solarContractUnlock.deleteMany({ where: { leadId } });
  await db.solarDealAdder.deleteMany({ where: { leadId } });
  await db.solarProposal.deleteMany({ where: { leadId } });
  await db.solarFinance.deleteMany({ where: { leadId } });
  await db.solarDesign.deleteMany({ where: { leadId } });
  await db.solarDesign.create({
    data: {
      companyId, leadId, vertical: "solar", systemType: "pv_storage",
      moduleId, moduleQty: 30, systemSizeKwDc: 12, batteryId, batteryQty: 2,
      lenderId: lenderA, year1ProductionKwh: 14_000, annualUsageKwh: 14_000,
    },
  });
  await db.solarProposal.create({
    data: { companyId, leadId, version: 1, status: "generated", snapshot: { schemaVersion: 7 } as never },
  });
  actAs("sales_rep");
  await savePrice(350);
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("before the customer signs, everything moves", () => {
  it("lets a rep price the deal", async () => {
    actAs("sales_rep");
    expect((await savePrice(400)).ok).toBe(true);
    expect((await finance())?.baseFinalPpwCents).toBe(400);
  });

  it("reports the deal as unsigned", async () => {
    expect(await dealSignedAt(companyId, leadId)).toBeNull();
  });
});

describe("after the customer signs, the economics are locked", () => {
  beforeEach(sign);

  it("REFUSES a rep raising the price — the change that moves their own pay", async () => {
    actAs("sales_rep");
    const before = (await finance())?.baseFinalPpwCents;
    const res = await savePrice(900);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/signed/i);
    expect((await finance())?.baseFinalPpwCents).toBe(before);
  });

  it("REFUSES a manager, and an ADMIN, too", async () => {
    for (const role of ["manager", "admin"] as Role[]) {
      actAs(role);
      const res = await savePrice(900);
      expect(res.ok, `${role} must not rewrite a signed contract`).toBe(false);
    }
    expect((await finance())?.baseFinalPpwCents).toBe(350);
  });

  it("REFUSES changing the equipment or the panel count", async () => {
    actAs("sales_rep");
    const res = await inSolar(() =>
      setSolarDesignEquipmentAction({ leadId, moduleQty: 60 } as Parameters<
        typeof setSolarDesignEquipmentAction
      >[0])
    );
    expect(res.ok).toBe(false);
    expect((await design())?.moduleQty).toBe(30);
  });

  it("REFUSES changing the battery count", async () => {
    actAs("sales_rep");
    const res = await inSolar(() =>
      setSolarDesignEquipmentAction({ leadId, batteryQty: 9 } as Parameters<
        typeof setSolarDesignEquipmentAction
      >[0])
    );
    expect(res.ok).toBe(false);
    expect((await design())?.batteryQty).toBe(2);
  });

  it("REFUSES moving the deal to another lender", async () => {
    actAs("sales_rep");
    const res = await inSolar(() => setSolarDealLenderAction({ leadId, lenderId: lenderB }));
    expect(res.ok).toBe(false);
    expect((await design())?.lenderId).toBe(lenderA);
  });

  it("REFUSES adding an adder", async () => {
    actAs("sales_rep");
    const res = await inSolar(() =>
      addDealAdderAction({
        leadId, label: "Trenching", basis: "flat", flatCents: 500_000, qty: 1,
        showOnProposal: false, outsidePriceRule: false,
      } as Parameters<typeof addDealAdderAction>[0])
    );
    expect(res.ok).toBe(false);
    expect(await db.solarDealAdder.count({ where: { leadId } })).toBe(0);
  });

  it("REFUSES changing the tax-credit assumptions", async () => {
    actAs("sales_rep");
    const res = await inSolar(() =>
      setSolarCreditClaimsAction({
        leadId, claimItc: false, claimEnergyCommunity: false, claimDomesticContent: false,
      })
    );
    expect(res.ok).toBe(false);
    expect((await finance())?.claimItc).toBe(true);
  });

  it("locks on ANY signed version, not merely the newest", async () => {
    // v1 is signed; a later draft exists. The deal is still sold.
    await db.solarProposal.create({
      data: { companyId, leadId, version: 2, status: "generated", snapshot: { schemaVersion: 7 } as never },
    });
    actAs("sales_rep");
    expect((await savePrice(900)).ok).toBe(false);
  });
});

describe("a super admin must reopen the contract, and say why", () => {
  beforeEach(sign);

  const REASON = "Lender correction — Amos re-issued at a 22% fee";

  it("REFUSES a super admin who has not reopened it, and says which door to use", async () => {
    // Holding the authority is not the same as using it. Without a live unlock
    // the lock refuses a super admin exactly as it refuses anybody else.
    actAs("super_admin");
    const res = await savePrice(500);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/reopen it first and give a reason/i);
    expect((await finance())?.baseFinalPpwCents).toBe(350);
  });

  it("REFUSES an unlock with no real reason", async () => {
    actAs("super_admin");
    for (const reason of ["", "   ", "oops"]) {
      const res = await inSolar(() => unlockSignedContractAction({ leadId, reason }));
      expect(res.ok, `reason "${reason}"`).toBe(false);
    }
    expect(await db.solarContractUnlock.count({ where: { leadId } })).toBe(0);
  });

  it("REFUSES an unlock from an admin — this is narrower than running the floor", async () => {
    actAs("admin");
    const res = await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/super admin/i);
    expect(await db.solarContractUnlock.count({ where: { leadId } })).toBe(0);
  });

  it("lets the price through once reopened", async () => {
    actAs("super_admin");
    expect((await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }))).ok).toBe(true);

    const res = await savePrice(500);
    expect(res.ok).toBe(true);
    expect((await finance())?.baseFinalPpwCents).toBe(500);
  });

  it("records who, when, why, and both figures on the deal's own history", async () => {
    const before = (await finance())!.finalPriceCents;
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    await savePrice(500);
    const after = (await finance())!.finalPriceCents;
    expect(after).not.toBe(before);

    const logs = await db.activityLog.findMany({ where: { leadId }, orderBy: { createdAt: "asc" } });

    // 1 — the decision, with the reason, before anything changed.
    const opened = logs.find((l) => /reopened this SIGNED contract/i.test(l.message));
    expect(opened).toBeDefined();
    expect(opened?.actorId).toBe(users.super_admin);
    expect(opened?.message).toContain(REASON);

    // 2 — the edit, naming the area and citing the same reason.
    const edited = logs.find((l) => /edited the price and financing on a SIGNED contract/i.test(l.message));
    expect(edited?.message).toContain(REASON);

    // 3 — the figures, old and new, with the reason again.
    const moved = logs.find((l) => /changed the contract price on a SIGNED contract/i.test(l.message));
    expect(moved?.message).toContain(String(before));
    expect(moved?.message).toContain(String(after));
    expect(moved?.message).toContain(REASON);
  });

  it("one reason covers the whole sitting, not one field", async () => {
    // A super admin who reopens a contract and changes three things has made
    // one decision. They are not asked three times.
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));

    expect((await savePrice(500)).ok).toBe(true);
    expect((await inSolar(() => setSolarDealLenderAction({ leadId, lenderId: lenderB }))).ok).toBe(true);
    expect(
      (await inSolar(() =>
        setSolarCreditClaimsAction({
          leadId, claimItc: false, claimEnergyCommunity: false, claimDomesticContent: false,
        })
      )).ok
    ).toBe(true);

    expect(await db.solarContractUnlock.count({ where: { leadId } })).toBe(1);
  });

  it("closes again on request, and the lock comes straight back", async () => {
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    expect((await savePrice(500)).ok).toBe(true);

    expect((await inSolar(() => relockSignedContractAction(leadId))).ok).toBe(true);
    const res = await savePrice(600);
    expect(res.ok).toBe(false);
    expect((await finance())?.baseFinalPpwCents).toBe(500);
  });

  it("EXPIRES — an unlock left open is not a lock removed", async () => {
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    // Wind it back past its window rather than waiting thirty minutes.
    await db.solarContractUnlock.updateMany({
      where: { leadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const res = await savePrice(700);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/reopen it first/i);
  });

  it("keeps the lapsed row — it is the record that an exception was made", async () => {
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    await inSolar(() => relockSignedContractAction(leadId));

    const rows = await db.solarContractUnlock.findMany({ where: { leadId } });
    expect(rows).toHaveLength(1);
    expect(rows[0].reason).toBe(REASON);
    expect(rows[0].unlockedById).toBe(users.super_admin);
  });

  it("will not reopen a contract nobody has signed", async () => {
    await unsign();
    actAs("super_admin");
    const res = await inSolar(() => unlockSignedContractAction({ leadId, reason: REASON }));
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/not been signed/i);
  });

  it("writes NO override trail on a deal that was never signed", async () => {
    await unsign();
    await db.activityLog.deleteMany({ where: { companyId } });
    actAs("super_admin");
    await savePrice(600);
    const logs = await db.activityLog.findMany({ where: { leadId, message: { contains: "SIGNED contract" } } });
    expect(logs).toHaveLength(0);
  });
});

describe("nothing zeroes a signed deal — the shape of deal 5886e6ac", () => {
  /**
   * The one real signed customer deal in production: a signed v1 with a NEWER
   * UNSIGNED version behind it. That pairing is what made the live re-price
   * reachable — it refused a signed PROPOSAL and never asked about the DEAL.
   */
  let draftId: string;
  beforeEach(async () => {
    await sign();
    const draft = await db.solarProposal.create({
      data: { companyId, leadId, version: 3, status: "generated", snapshot: { schemaVersion: 7 } as never },
      select: { id: true },
    });
    draftId = draft.id;
    actAs("sales_rep");
  });

  const LAYOUT = [
    { id: "b1", originE: 0, originN: 0, rotationDeg: 0, cols: 5, rows: 4,
      orientation: "portrait" as const, omitted: [], azimuthDeg: 180, tiltDeg: 20 },
  ];

  it("REFUSES a rep re-pricing the signed DEAL through its unsigned next version", async () => {
    const before = await finance();
    const res = await inSolar(() => repriceProposalAction({ proposalId: draftId, grossPpwCents: 0 }));
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/signed/i);
    expect(await finance()).toEqual(before);
  });

  it("REFUSES a rep wiping the array from the layout designer", async () => {
    const before = await design();
    const res = await inSolar(() => saveSolarLayoutAction({ leadId, blocks: [] }));
    expect(res.ok).toBe(false);
    expect(await design()).toEqual(before);
  });

  it("REFUSES a rep redrawing it, too — the size is what the price is made of", async () => {
    const before = await design();
    const res = await inSolar(() => saveSolarLayoutAction({ leadId, blocks: LAYOUT }));
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/signed/i);
    expect(await design()).toEqual(before);
  });

  it("refuses an empty drawing even on an UNSIGNED deal — a zero is not a price", async () => {
    await unsign();
    const res = await inSolar(() => saveSolarLayoutAction({ leadId, blocks: [] }));
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/no panels/i);
  });

  it("holds even when a caller forgets to ask: the recompute itself refuses", async () => {
    // An adder written straight to the table, past the guarded action. The
    // contract would move the moment anything recomputed.
    await db.solarDealAdder.create({
      data: { companyId, leadId, qty: 1, sortOrder: 0, label: "Trenching", basis: "flat", flatCents: 500_000 },
    });
    const before = await finance();
    expect(await inSolar(() => recomputeDealMoney(companyId, leadId))).toMatchObject({
      changed: false,
      blocked: true,
    });
    expect(await finance()).toEqual(before);
  });

  it("lets it through under an unlock, and says what moved", async () => {
    await db.solarDealAdder.create({
      data: { companyId, leadId, qty: 1, sortOrder: 0, label: "Trenching", basis: "flat", flatCents: 500_000 },
    });
    const before = (await finance())!.finalPriceCents;
    actAs("super_admin");
    await inSolar(() => unlockSignedContractAction({ leadId, reason: "Lender correction — re-issued" }));

    expect(await inSolar(() => recomputeDealMoney(companyId, leadId))).toMatchObject({ changed: true });
    const after = (await finance())!.finalPriceCents;
    expect(after).not.toBe(before);

    const log = await db.activityLog.findFirst({
      where: { leadId, message: { contains: "Recomputed the deal's money on a SIGNED contract" } },
    });
    expect(log?.message).toContain(String(before));
    expect(log?.message).toContain(String(after));
    expect(log?.message).toContain("Lender correction — re-issued");
    expect(log?.actorId).toBe(users.super_admin);
  });
});

describe("what a signature does NOT freeze", () => {
  beforeEach(sign);

  it("leaves the operational record moving", async () => {
    // Permit numbers, AHJ contacts, interconnection and PTO all belong to the
    // months of work after the sale. A signature that stopped those would stop
    // the job. Written straight to the row, as the operations tab does.
    await db.solarDesign.update({
      where: { leadId },
      data: { permitNumber: "PMT-2026-114", ahjName: "City of Katy", ptoNotRequired: false },
    });
    const d = await design();
    expect(d?.permitNumber).toBe("PMT-2026-114");
    expect(d?.ahjName).toBe("City of Katy");
  });
});
