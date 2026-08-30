import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import type { SessionUser } from "@/server/auth/session";
import type { SolarProposalSnapshot } from "@/lib/solar-proposal";
import { DISCLOSURE_TEMPLATE_SUGGESTION } from "@/lib/solar-contract-adjustment";

/**
 * A partner whose contract is written for more than the household owes, driven
 * through the real generator against a real database.
 *
 * Everything that matters about this feature is a fact about TIME, and none of
 * it can be observed in a pure function:
 *
 *  - Changing the adjustment in Settings must move nothing that already exists.
 *    A snapshot is JSON in a column; whether it stayed put is a question for
 *    the column.
 *  - A signed proposal's fingerprint is taken over that JSON, so "the settings
 *    changed and the signature still verifies" is the same question asked a
 *    second way — and it is the question a dispute actually turns on.
 *  - Regenerating has to make a NEW version and supersede the old one rather
 *    than editing it, which is a constraint on rows.
 *
 * The worked example throughout: 8.80 kW at $5.50/W is $48,400, a $70,000
 * programme contribution puts the contract at $118,400, and the household's
 * payment is $134.44 over 360 months at 0%.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

/**
 * The session, stubbed at the door.
 *
 * `upsertSolarLenderAction` is the real thing under test here — its
 * completeness guards and its audit writer — and the only part of it this suite
 * cannot supply is a signed-in user. Everything past `requireUser` runs exactly
 * as it does in production, including the RBAC check, which the owner passes.
 */
const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

const { generateProposalVersion } = await import("../proposal-generate");
const { snapshotFingerprint } = await import("../proposal-signature");
const { upsertSolarLenderAction } = await import("../actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let lenderId: string;
let productId: string;
let user: SessionUser;

const PARTICIPATE_CENTS = 70_000_00;
const CUSTOMER_CENTS = 48_400_00;
const LABEL = "Participate Program Contribution";

/** Switch the partner's programme to a given amount, or off. */
async function setAdjustment(over: {
  enabled?: boolean;
  cents?: number | null;
  label?: string | null;
  disclosure?: string | null;
  effectiveAt?: Date | null;
}) {
  await db.solarLender.update({
    where: { id: lenderId },
    data: {
      contractAdjustmentEnabled: over.enabled ?? true,
      contractAdjustmentCents: over.cents === undefined ? PARTICIPATE_CENTS : over.cents,
      contractAdjustmentLabel: over.label === undefined ? LABEL : over.label,
      contractAdjustmentDisclosure:
        over.disclosure === undefined ? DISCLOSURE_TEMPLATE_SUGGESTION : over.disclosure,
      contractAdjustmentEffectiveAt: over.effectiveAt ?? null,
    },
  });
}

const generate = () => runInVertical("solar", () => generateProposalVersion(user, leadId));

async function snapshotOf(id: string): Promise<SolarProposalSnapshot> {
  const row = await db.solarProposal.findUniqueOrThrow({ where: { id }, select: { snapshot: true } });
  return row.snapshot as unknown as SolarProposalSnapshot;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: {
      name: "Participate Test Co",
      slug: `part-${process.pid}-${Date.now()}`,
      phone: "(866) 650-9996",
      email: "support@example.com",
      address: "1 Test Way",
      city: "Dallas",
      state: "TX",
      zip: "75001",
    },
  });
  companyId = company.id;

  const owner = await db.user.create({
    data: {
      companyId,
      email: `owner-${process.pid}-${Date.now()}@example.com`,
      firstName: "Ola",
      lastName: "Owner",
      role: "super_admin",
    },
  });
  user = {
    userId: owner.id,
    companyId,
    role: "super_admin",
    fullName: "Ola Owner",
    permissions: {},
  } as unknown as SessionUser;
  requireUser.mockResolvedValue(user);

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId: pipeline.id,
      stageId: stage.id,
      firstName: "Priya",
      lastName: "Raman",
      address: "902 Solaris Way",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      lat: 32.78,
      lng: -96.8,
    },
  });
  leadId = lead.id;

  const module = await db.solarEquipment.create({
    data: {
      companyId,
      kind: "module",
      manufacturer: "Qcells",
      model: `Q.PEAK-${process.pid}`,
      ratingW: 400,
      widthMm: 1134,
      heightMm: 1879,
    },
  });

  // The partner: a flat $5.50/W to the homeowner on a 65% fee — Amos's shape,
  // which is what makes 8.8 kW come to exactly $48,400.
  const lender = await db.solarLender.create({
    data: {
      companyId,
      name: "Participate",
      maxFinalPpwCents: 550,
      finalPpwMode: "flat",
    },
  });
  lenderId = lender.id;

  const product = await db.solarLenderProduct.create({
    data: {
      companyId,
      lenderId,
      product: "loan",
      name: "30 yr · 0.00%",
      aprPct: 0,
      termMonths: 360,
      dealerFeePct: 65,
    },
  });
  productId = product.id;

  await db.solarDesign.create({
    data: {
      companyId,
      leadId,
      lenderId,
      systemType: "pv",
      moduleId: module.id,
      moduleQty: 22,
      systemSizeKwDc: 8.8,
      year1ProductionKwh: 10_718,
      annualUsageKwh: 12_000,
      offsetPct: 89,
      avgMonthlyBillCents: 21_000,
      utilityRateMills: 150,
      utilityProvider: "Oncor",
      // Readiness asks only whether a drawing was attached. The bytes behind it
      // are checked at render, and their absence simply omits the picture.
      layoutImageFileId: "00000000-0000-0000-0000-000000000001",
    },
  });

  await db.solarFinance.create({
    data: {
      companyId,
      leadId,
      product: "loan",
      lenderProductId: productId,
      grossPpwCents: 550,
      dealerFeePct: 65,
      contractPriceCents: CUSTOMER_CENTS,
      aprPct: 0,
      loanTermMonths: 360,
    },
  });
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
  await setAdjustment({});
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the two figures reach the document", () => {
  it("quotes the $118,400 contract and prices the payment on it", async () => {
    const res = await generate();
    expect(res.ok, "ok" in res && !res.ok ? res.error : "").toBe(true);
    if (!res.ok) return;

    const f = res.snapshot.financing;
    expect(f.contractPriceCents).toBe(118_400_00);
    expect(f.financedAmountCents).toBe(118_400_00);
    expect(f.loanMonthlyPaymentCents).toBe(32_889);
    expect(f.lenderAdjustment).toEqual({
      label: LABEL,
      adjustmentCents: PARTICIPATE_CENTS,
      customerObligationCents: CUSTOMER_CENTS,
      lenderContractValueCents: 118_400_00,
      disclosure: expect.stringContaining("$118,400"),
    });
  });

  it("brings the household back to $48,400 on the ladder, and quotes that payment too", async () => {
    const res = await generate();
    if (!res.ok) throw new Error(res.error);

    const l = res.snapshot.financing.creditLadder;
    expect(l).toBeTruthy();
    // 30 + 10 + 10 of $118,400, then the difference.
    expect(l!.creditTotalCents).toBe(59_200_00);
    expect(l!.incentiveCents).toBe(10_800_00);
    expect(l!.netCostCents).toBe(CUSTOMER_CENTS);
    expect(res.snapshot.financing.netMonthlyPaymentCents).toBe(13_444);
  });

  it("drops a bonus this job does not earn, and the incentive absorbs it", async () => {
    await db.solarFinance.update({
      where: { leadId },
      data: { claimEnergyCommunity: false },
    });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);

    const l = res.snapshot.financing.creditLadder!;
    expect(l.credits.map((c) => c.key)).toEqual(["itc", "domesticContent"]);
    expect(l.creditTotalCents).toBe(47_360_00);
    expect(l.incentiveCents).toBe(22_640_00);
    // The bottom line does not move: what the household pays is the price the
    // rep quoted, whichever bonuses the job earns.
    expect(l.netCostCents).toBe(CUSTOMER_CENTS);

    await db.solarFinance.update({ where: { leadId }, data: { claimEnergyCommunity: true } });
  });

  it("leaves the deal's own value at what the customer owes", async () => {
    // `Lead.value` is what the pipeline board and the funnel report add up.
    // A contract value there would inflate every total in the company by the
    // programme's contribution.
    await generate();
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId }, select: { value: true } });
    expect(lead.value).toBe(CUSTOMER_CENTS);
  });

  it("records which figure was applied, on the version's own event", async () => {
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    const events = await db.solarProposalEvent.findMany({
      where: { proposalId: res.id, type: "generated" },
      select: { detail: true },
    });
    expect(events[0]?.detail).toContain(LABEL);
    expect(events[0]?.detail).toContain("$118,400");
    expect(events[0]?.detail).toContain("$48,400");
  });
});

describe("changing the setting moves nothing that already exists", () => {
  it("leaves an existing version quoting the figure it was generated with", async () => {
    const first = await generate();
    if (!first.ok) throw new Error(first.error);

    await setAdjustment({ cents: 90_000_00 });

    const before = await snapshotOf(first.id);
    expect(before.financing.lenderAdjustment?.adjustmentCents).toBe(PARTICIPATE_CENTS);
    expect(before.financing.lenderAdjustment?.lenderContractValueCents).toBe(118_400_00);
    expect(before.financing.lenderAdjustment?.disclosure).toContain("$70,000");
  });

  it("applies the new figure to the NEXT version only", async () => {
    const first = await generate();
    if (!first.ok) throw new Error(first.error);

    await setAdjustment({ cents: 90_000_00 });
    const second = await generate();
    if (!second.ok) throw new Error(second.error);

    expect(second.version).toBe(first.version + 1);
    expect(second.snapshot.financing.lenderAdjustment?.adjustmentCents).toBe(90_000_00);
    expect(second.snapshot.financing.lenderAdjustment?.lenderContractValueCents).toBe(138_400_00);
    // The contract the document quotes moves with it, and the ladder still
    // lands the household on the price the system was sold at.
    expect(second.snapshot.financing.contractPriceCents).toBe(138_400_00);
    expect(second.snapshot.financing.creditLadder?.netCostCents).toBe(CUSTOMER_CENTS);

    // The old one is superseded, not edited.
    const old = await db.solarProposal.findUniqueOrThrow({
      where: { id: first.id },
      select: { supersededAt: true },
    });
    expect(old.supersededAt).not.toBeNull();
    expect((await snapshotOf(first.id)).financing.lenderAdjustment?.adjustmentCents).toBe(
      PARTICIPATE_CENTS
    );
  });

  it("keeps a SIGNED version's figures, and its fingerprint, through a settings change", async () => {
    const signed = await generate();
    if (!signed.ok) throw new Error(signed.error);

    const before = await db.solarProposal.findUniqueOrThrow({
      where: { id: signed.id },
      select: { snapshot: true },
    });
    const fingerprintBefore = snapshotFingerprint(before.snapshot);

    await db.solarProposal.update({
      where: { id: signed.id },
      data: {
        status: "signed",
        signedAt: new Date(),
        signerName: "Priya Raman",
        consentAt: new Date(),
        signedVia: "remote",
      },
    });

    // Everything an admin could do to the programme afterwards.
    await setAdjustment({ cents: 5_000_00, label: "Something Else", enabled: true });
    await setAdjustment({ enabled: false, cents: null, label: null, disclosure: null });

    const after = await db.solarProposal.findUniqueOrThrow({
      where: { id: signed.id },
      select: { snapshot: true },
    });
    expect(snapshotFingerprint(after.snapshot)).toBe(fingerprintBefore);

    const s = after.snapshot as unknown as SolarProposalSnapshot;
    expect(s.financing.lenderAdjustment?.adjustmentCents).toBe(PARTICIPATE_CENTS);
    expect(s.financing.lenderAdjustment?.label).toBe(LABEL);
  });

  it("builds a new version after a signature without touching the signed one", () => {
    // A signed version does NOT close the deal to new ones — see the note in
    // proposal-generate. What has to survive is the RECORD, and that is what
    // this asserts: the signed row keeps its own figures and its own
    // fingerprint while a fresh version is written beside it at the new rate.
    return (async () => {
      const signed = await generate();
      if (!signed.ok) throw new Error(signed.error);

      const before = await db.solarProposal.findUniqueOrThrow({
        where: { id: signed.id },
        select: { snapshot: true },
      });
      const fingerprintBefore = snapshotFingerprint(before.snapshot);

      await db.solarProposal.update({
        where: { id: signed.id },
        data: { signedAt: new Date(), status: "signed", signerName: "Priya Raman" },
      });

      await setAdjustment({ cents: 90_000_00 });
      const next = await generate();
      if (!next.ok) throw new Error(next.error);

      expect(next.version).toBe(signed.version + 1);
      expect(next.snapshot.financing.lenderAdjustment?.adjustmentCents).toBe(90_000_00);

      const after = await db.solarProposal.findUniqueOrThrow({
        where: { id: signed.id },
        select: { snapshot: true, signedAt: true, signerName: true },
      });
      expect(snapshotFingerprint(after.snapshot)).toBe(fingerprintBefore);
      expect(after.signerName).toBe("Priya Raman");
      expect(
        (after.snapshot as unknown as SolarProposalSnapshot).financing.lenderAdjustment
          ?.adjustmentCents
      ).toBe(PARTICIPATE_CENTS);
    })();
  });
});

describe("a programme nobody finished configuring", () => {
  it("blocks generation rather than quietly leaving the reconciliation out", async () => {
    await setAdjustment({ cents: null });
    const res = await generate();
    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.issues?.some((i) => i.code === "pricing.adjustment_incomplete")).toBe(true);
    }
  });

  it("blocks on a missing label, and on a missing disclosure", async () => {
    await setAdjustment({ label: null });
    expect((await generate()).ok).toBe(false);

    await setAdjustment({ disclosure: null });
    expect((await generate()).ok).toBe(false);
  });

  it("generates a perfectly ordinary proposal once the programme is switched off", async () => {
    await setAdjustment({ enabled: false, cents: null, label: null, disclosure: null });
    const res = await generate();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.financing.lenderAdjustment).toBeUndefined();
    expect(res.snapshot.financing.contractPriceCents).toBe(CUSTOMER_CENTS);
  });
});

describe("the effective date", () => {
  it("quotes no adjustment before the programme starts", async () => {
    await setAdjustment({ effectiveAt: new Date(Date.now() + 30 * 24 * 3600 * 1000) });
    const res = await generate();
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.snapshot.financing.lenderAdjustment).toBeUndefined();
  });

  it("quotes it once the date has passed", async () => {
    await setAdjustment({ effectiveAt: new Date(Date.now() - 24 * 3600 * 1000) });
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect(res.snapshot.financing.lenderAdjustment?.lenderContractValueCents).toBe(118_400_00);
  });
});

describe("the audit trail on the setting itself", () => {
  it("records who changed the amount, from what, to what, and when", async () => {
    await db.activityLog.deleteMany({ where: { companyId } });

    const res = await runInVertical("solar", () =>
      upsertSolarLenderAction(lenderId, {
        name: "Participate",
        contractAdjustmentEnabled: true,
        contractAdjustmentCents: 90_000_00,
        contractAdjustmentLabel: LABEL,
        contractAdjustmentDisclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
      })
    );
    expect(res.ok).toBe(true);

    const logged = await db.activityLog.findFirst({
      where: { companyId, message: { contains: "contract adjustment" } },
      select: { message: true, actorId: true, metadata: true, createdAt: true },
    });

    expect(logged?.actorId).toBe(user.userId);
    expect(logged?.message).toContain("Ola Owner");
    expect(logged?.message).toContain("Participate");
    expect(logged?.message).toContain("$70,000.00 → $90,000.00");
    expect(logged?.createdAt).toBeInstanceOf(Date);

    const meta = logged?.metadata as { lenderId?: string; changes?: { field: string }[] };
    expect(meta.lenderId).toBe(lenderId);
    expect(meta.changes?.map((c) => c.field)).toContain("contractAdjustmentCents");
  });

  it("writes nothing when the money and the wording did not move", async () => {
    await db.activityLog.deleteMany({ where: { companyId } });

    // A rename is housekeeping. An audit row per save regardless would fill the
    // log with entries saying nothing happened, and the ones that matter would
    // be unfindable among them.
    await runInVertical("solar", () =>
      upsertSolarLenderAction(lenderId, {
        name: "Participate",
        notes: "Called them on Tuesday.",
        contractAdjustmentEnabled: true,
        contractAdjustmentCents: PARTICIPATE_CENTS,
        contractAdjustmentLabel: LABEL,
        contractAdjustmentDisclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
      })
    );

    expect(
      await db.activityLog.count({ where: { companyId, message: { contains: "contract adjustment" } } })
    ).toBe(0);
  });

  it("refuses to save a programme switched on with nothing behind it", async () => {
    const res = await runInVertical("solar", () =>
      upsertSolarLenderAction(lenderId, {
        name: "Participate",
        contractAdjustmentEnabled: true,
        contractAdjustmentCents: PARTICIPATE_CENTS,
        contractAdjustmentLabel: null,
        contractAdjustmentDisclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
      })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("customer-facing label");
  });

  it("records the effective date alongside the amount", async () => {
    await db.activityLog.deleteMany({ where: { companyId } });

    await runInVertical("solar", () =>
      upsertSolarLenderAction(lenderId, {
        name: "Participate",
        contractAdjustmentEnabled: true,
        contractAdjustmentCents: PARTICIPATE_CENTS,
        contractAdjustmentLabel: LABEL,
        contractAdjustmentDisclosure: DISCLOSURE_TEMPLATE_SUGGESTION,
        contractAdjustmentEffectiveAt: "2026-10-01",
      })
    );

    const logged = await db.activityLog.findFirst({
      where: { companyId, message: { contains: "contract adjustment" } },
      select: { message: true },
    });
    expect(logged?.message).toContain("effective date: not set → 2026-10-01");
  });
});
