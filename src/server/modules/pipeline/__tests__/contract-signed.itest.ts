import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import type { Role } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * CONTRACT SIGNED NEEDS BOTH DOCUMENTS — proved through the server actions.
 *
 * A solar deal reaches Contract Signed only when the customer has signed the
 * proposal AND a completed contract is in the deal's Contract folder (Anexa's
 * e-signed contract, or the lender's — Amos's — marked as the signed contract there). Every path that
 * can move a deal is driven here the way a hand-rolled request would drive it,
 * with no UI in the loop, because hiding a control is not a control.
 *
 * The pipeline is PRODUCTION'S shape: the sale stage is hand-made, renamed
 * "Contract Signed / Hold", and does not carry the seeded `contract_signed`
 * key. What makes it the gate is `PipelineStage.milestone` and nothing else.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";
process.env.AUTH_SECRET = "test-secret-for-contract-signed";

const session = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/server/auth/session", () => session);
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
// Notifications and automations fire at the end of a move; neither is under
// test and both reach for infrastructure this suite has none of.
vi.mock("@/server/modules/notifications/engine", () => ({ fireEvent: vi.fn() }));
vi.mock("@/server/modules/automations/engine", () => ({ runAutomations: vi.fn() }));
vi.mock("@/server/auth/vertical", () => ({ getActiveVertical: vi.fn(async () => "solar") }));

const { moveLeadStage, cancelLeadAction } = await import("@/server/modules/leads/actions");
const { updateLeadAction } = await import("@/server/modules/leads/manage");
const { uploadFileAction, moveFileAction, setSignedLenderContractAction } = await import(
  "@/server/modules/files/actions"
);
const { updateTemplateAction } = await import("@/server/modules/esign/actions");
const { moveStageAction } = await import("@/server/modules/automations/actions/move-stage");
const { acceptSolarProposal } = await import("@/server/modules/solar/proposal-public");
const { advanceToContractSignedIfReady, guardedStageId } = await import(
  "@/server/modules/pipeline/contract-signed"
);
const { updatePipelineStageAction, deletePipelineStageAction } = await import(
  "@/server/modules/settings/actions"
);

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let otherCompanyStageId: string;
let pipelineId: string;
let leadId: string;
let roofingLeadId: string;
const stages: Record<string, string> = {};
const roof: Record<string, string> = {};
const users: Partial<Record<Role | "other_rep", string>> = {};

const CS = "contract_signed_hold_2";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const SNAPSHOT = {
  schemaVersion: 2,
  generatedAt: "2026-09-15T12:00:00.000Z",
  generatedById: null,
  reference: "SP-CS-V1",
  customer: { name: "Dana Homeowner", address: "9 Signature Row" },
  company: { name: "Anexa", phone: null, email: null, logoUrl: null, address: null },
  representative: null,
  energy: { utilityProvider: null, ratePlan: null, annualUsageKwh: 14000, avgMonthlyBillCents: 18000, currentAnnualCostCents: 215600 },
  system: { sizeKwDc: 8, year1ProductionKwh: 8282, offsetPct: 59, moduleLabel: null, moduleQty: 20, inverterLabel: null, batteryLabel: null, mountType: "roof", utilityProvider: null, netMeteringProgram: null, tsrfPct: 85, module: null, inverter: null, battery: null },
  layout: null,
  financing: { product: "cash", contractPriceCents: 2800000, grossPpwCents: 350, basePriceCents: 2800000, adderTotalCents: null, finalPpwCents: 350, monthlyPaymentCents: null, rateMillsPerKwh: null, escalatorPct: null, termYears: null, aprPct: null, lender: null, itcEstimateCents: null, itcPct: null, stateIncentiveNote: null },
  savings: { years: [], utilityCostAvoidedCents: 0, solarPaidCents: 0, netSavingsCents: 0, totalSavingsCents: 0, paybackYear: null },
  environmental: { tonsCo2Avoided: 0, treesEquivalent: 0, poundsCoalAvoided: 0, milesNotDriven: 0 },
  assumptions: { derateFactor: 0.84, annualDegradationPct: 0.5, utilityEscalationPct: 3.5, kwhPerKwYear: 1450, utilityMeterFeeCents: 1000, companyDefaultBasePpwCents: 350, defaultDealerFeePct: 18, minOffsetPct: 0, maxOffsetPct: 150, currentRateMillsPerKwh: 154 },
  disclaimers: { estimate: "y" },
};

const GOOD_SIGNATURE = {
  name: "Dana Homeowner",
  signature: PNG,
  signatureType: "drawn" as const,
  consentAtMs: Date.now() - 60_000,
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (iPhone)",
};

function actAs(role: Role | "other_rep") {
  session.requireUser.mockResolvedValue({
    userId: users[role]!,
    companyId,
    role: role === "other_rep" ? "sales_rep" : role,
    permissions: {},
    fullName: `${role} user`,
  });
}

const solar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);
const moveTo = (key: string) => solar(() => moveLeadStage({ leadId, stageId: stages[key] }));
const stageKeyOf = async (id = leadId) => {
  const lead = await db.lead.findUniqueOrThrow({ where: { id }, select: { stage: { select: { key: true } } } });
  return lead.stage?.key ?? null;
};
const setStage = (key: string) => db.lead.update({ where: { id: leadId }, data: { stageId: stages[key] } });

/** The customer signed a proposal on this deal. */
const signedProposal = () =>
  db.solarProposal.create({
    data: { companyId, leadId, version: 1, status: "signed", signedAt: new Date(), snapshot: SNAPSHOT as never },
  });

/** THE solar contract template, and an ordinary one (a utility authorisation). */
let contractTemplateId: string;
let otherTemplateId: string;

type PackageStatus = "completed" | "sent" | "viewed" | "partially_signed" | "declined" | "voided";

/**
 * An e-signature package on this deal. By default Anexa's own contract signed
 * to completion: a package of the template classified as the solar contract,
 * filed to Contract (`folderKey` null = Contract).
 */
const completedContractPackage = (
  folderKey: string | null = null,
  opts: { status?: PackageStatus; templateId?: string | null } = {},
) =>
  db.documentPackage.create({
    data: {
      companyId, leadId, vertical: "solar", title: "Solar Agreement", status: opts.status ?? "completed", folderKey,
      templateId: opts.templateId === undefined ? contractTemplateId : opts.templateId,
    },
  });

/** A file on this deal. Classified as nothing unless told. */
const filedDocument = (
  category: string,
  opts: {
    name?: string;
    mimeType?: string;
    kind?: "document" | "photo" | "signed_document";
    documentType?: "signed_lender_contract" | null;
  } = {},
) =>
  db.fileAsset.create({
    data: {
      companyId, leadId, kind: opts.kind ?? "document", name: opts.name ?? "Amos Signed Contract.pdf", category,
      storageKey: `test/${randomBytes(8).toString("hex")}.pdf`, mimeType: opts.mimeType ?? "application/pdf", size: 10,
      uploadedById: users.admin, documentType: opts.documentType ?? null,
    },
    select: { id: true },
  });

/** The lender's signed contract: a PDF, MARKED as such. In Contract unless told. */
const markedLenderContract = (category = "contract") =>
  filedDocument(category, { documentType: "signed_lender_contract" });

const lastEntryVia = async () =>
  (await db.leadStageEvent.findFirst({
    where: { leadId, stageId: stages[CS] },
    orderBy: { enteredAt: "desc" },
    select: { via: true },
  }))?.via ?? null;

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Contract Signed Co", slug: `cs-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  contractTemplateId = (
    await db.documentTemplate.create({ data: { companyId, name: "Solar Agreement", vertical: "solar", type: "solar_contract" } })
  ).id;
  otherTemplateId = (
    await db.documentTemplate.create({ data: { companyId, name: "Utility Authorization", vertical: "solar", type: "custom" } })
  ).id;

  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  pipelineId = pipeline.id;
  const plan: [string, string, number, boolean, "contract_signed" | null][] = [
    ["new_appointment", "New Appointment", 0, false, null],
    ["proposal_sent", "Proposal Sent", 1, false, null],
    [CS, "Contract Signed / Hold", 2, false, "contract_signed"],
    ["permitting", "Permitting", 3, false, null],
    ["install_complete", "Install Complete", 4, false, null],
    ["cancelled_9", "Cancelled", 9, true, null],
  ];
  for (const [key, name, position, isLost, milestone] of plan) {
    const s = await db.pipelineStage.create({ data: { pipelineId, key, name, position, isLost, milestone } });
    stages[key] = s.id;
  }

  // Roofing keeps a stage literally keyed and named Contract Signed, with no
  // milestone. Nothing about this rule may reach it.
  const roofing = await db.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } });
  for (const [key, name, position] of [["new_lead", "New Lead", 0], ["contract_signed", "Contract Signed", 1]] as const) {
    const s = await db.pipelineStage.create({ data: { pipelineId: roofing.id, key, name, position } });
    roof[key] = s.id;
  }

  for (const role of ["sales_rep", "manager", "admin", "super_admin"] as Role[]) {
    const u = await db.user.create({
      data: { companyId, email: `${role}-cs-${process.pid}@test.local`, firstName: role, lastName: "User", role, passwordHash: "x" },
    });
    users[role] = u.id;
  }
  const other = await db.user.create({
    data: { companyId, email: `other-rep-cs-${process.pid}@test.local`, firstName: "Other", lastName: "Rep", role: "sales_rep", passwordHash: "x" },
  });
  users.other_rep = other.id;

  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId, stageId: stages.proposal_sent,
      firstName: "Dana", lastName: "Homeowner", email: "dana@example.com", assignedRepId: users.sales_rep,
    },
  });
  leadId = lead.id;

  const roofLead = await db.lead.create({
    data: { companyId, vertical: "roofing", pipelineId: roofing.id, stageId: roof.new_lead, firstName: "Roof", lastName: "Only" },
  });
  roofingLeadId = roofLead.id;

  const otherCompany = await db.company.create({
    data: { name: "Someone Else Solar", slug: `cs-other-${process.pid}-${Date.now()}` },
  });
  const otherPipeline = await db.pipeline.create({ data: { companyId: otherCompany.id, name: "Solar", vertical: "solar" } });
  otherCompanyStageId = (
    await db.pipelineStage.create({ data: { pipelineId: otherPipeline.id, key: "permitting", name: "Permitting", position: 3 } })
  ).id;
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
  await db.documentPackage.deleteMany({ where: { companyId } });
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.documentTemplate.update({ where: { id: contractTemplateId }, data: { type: "solar_contract" } });
  await db.documentTemplate.update({ where: { id: otherTemplateId }, data: { type: "custom" } });
  await db.leadStageEvent.deleteMany({ where: { leadId } });
  await db.lead.update({ where: { id: leadId }, data: { stageId: stages.proposal_sent, status: "open" } });
  await db.pipelineStage.update({ where: { id: stages[CS] }, data: { name: "Contract Signed / Hold", milestone: "contract_signed" } });
  actAs("admin");
});

afterAll(async () => {
  await db.company.deleteMany({ where: { slug: { startsWith: "cs-" } } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. The four combinations
// ---------------------------------------------------------------------------

describe("Contract Signed needs a signed proposal AND a completed contract", () => {
  it("neither → refused, and the deal does not move", async () => {
    const res = await moveTo(CS);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/signed proposal and a completed contract/);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("signed proposal only → refused, naming the missing contract", async () => {
    await signedProposal();
    const res = await moveTo(CS);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/completed contract in the Contract folder/);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("completed contract only → refused, naming the missing signature", async () => {
    await completedContractPackage();
    const res = await moveTo(CS);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/signature on the proposal/);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("both (Anexa's e-signed contract) → allowed", async () => {
    await signedProposal();
    await completedContractPackage();
    expect((await moveTo(CS)).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("both (the Amos contract, marked as the signed contract in the Contract folder) → allowed", async () => {
    await signedProposal();
    await markedLenderContract();
    expect((await moveTo(CS)).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("a completed package filed to ANOTHER folder is not a contract", async () => {
    await signedProposal();
    await completedContractPackage("permits");
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("the lender's contract left in Other is not filed into Contract", async () => {
    await signedProposal();
    await markedLenderContract("other");
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("a proposal that was only SENT is not a signature", async () => {
    await db.solarProposal.create({
      data: { companyId, leadId, version: 1, status: "sent", sentAt: new Date(), snapshot: SNAPSHOT as never },
    });
    await completedContractPackage();
    expect((await moveTo(CS)).ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 1b. Only RELIABLE evidence is a completed contract
// ---------------------------------------------------------------------------

describe("a file is not a contract for being in the Contract folder", () => {
  it("signed proposal + a random PDF in Contract → BLOCK", async () => {
    await signedProposal();
    await filedDocument("contract", { name: "Scan 0042.pdf" });
    const res = await moveTo(CS);
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/completed contract in the Contract folder/);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("signed proposal + a utility bill in Contract → BLOCK", async () => {
    await signedProposal();
    await filedDocument("contract", { name: "Oncor bill - August.pdf" });
    expect((await moveTo(CS)).ok).toBe(false);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("signed proposal + a photo in Contract → BLOCK, even carrying the mark", async () => {
    await signedProposal();
    await filedDocument("contract", {
      name: "IMG_2231.jpg", mimeType: "image/jpeg", kind: "photo", documentType: "signed_lender_contract",
    });
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("signed proposal + an unsigned document generated into Contract (the automation's output) → BLOCK", async () => {
    await signedProposal();
    await filedDocument("contract", { name: "Solar Agreement.pdf" });
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("signed proposal + a signed PDF of some other package refiled into Contract → BLOCK", async () => {
    await signedProposal();
    await filedDocument("contract", { name: "Proposal v1 (signed).pdf", kind: "signed_document" });
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("signed proposal + an incomplete or unsigned contract package → BLOCK, at every status short of completed", async () => {
    await signedProposal();
    for (const status of ["sent", "viewed", "partially_signed", "declined", "voided"] as const) {
      await db.documentPackage.deleteMany({ where: { companyId } });
      await completedContractPackage(null, { status });
      expect((await moveTo(CS)).ok, status).toBe(false);
    }
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("signed proposal + a COMPLETED package of a document that is not the contract, in Contract → BLOCK", async () => {
    await signedProposal();
    await completedContractPackage(null, { templateId: otherTemplateId });
    expect((await moveTo(CS)).ok).toBe(false);
    await db.documentPackage.deleteMany({ where: { companyId } });
    await completedContractPackage(null, { templateId: null });
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("signed proposal + completed Anexa contract → PASS", async () => {
    await signedProposal();
    await completedContractPackage();
    expect((await moveTo(CS)).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("signed proposal + properly classified completed Amos contract → PASS, and marking it advances the deal", async () => {
    await signedProposal();
    const file = await filedDocument("contract");
    expect((await moveTo(CS)).ok).toBe(false);
    expect((await solar(() => setSignedLenderContractAction({ fileId: file.id, signed: true }))).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
    expect(await lastEntryVia()).toBe("document");
  });
});

describe("marking a PDF as the lender's signed contract", () => {
  it("the deal's own sales rep cannot", async () => {
    await signedProposal();
    const file = await filedDocument("contract");
    actAs("sales_rep");
    const res = await solar(() => setSignedLenderContractAction({ fileId: file.id, signed: true }));
    expect(res.ok).toBe(false);
    expect((await db.fileAsset.findUniqueOrThrow({ where: { id: file.id } })).documentType).toBeNull();
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("records who marked it and when", async () => {
    const file = await filedDocument("contract");
    expect((await solar(() => setSignedLenderContractAction({ fileId: file.id, signed: true }))).ok).toBe(true);
    const row = await db.fileAsset.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.documentType).toBe("signed_lender_contract");
    expect(row.documentTypeSetById).toBe(users.admin);
    expect(row.documentTypeSetAt).toBeInstanceOf(Date);
  });

  it("only a PDF, and only in the Contract folder", async () => {
    const photo = await filedDocument("contract", { name: "IMG_1.jpg", mimeType: "image/jpeg", kind: "photo" });
    expect((await solar(() => setSignedLenderContractAction({ fileId: photo.id, signed: true }))).ok).toBe(false);
    const elsewhere = await filedDocument("utility_bill", { name: "Amos Signed Contract.pdf" });
    expect((await solar(() => setSignedLenderContractAction({ fileId: elsewhere.id, signed: true }))).ok).toBe(false);
    expect(await db.fileAsset.count({ where: { companyId, documentType: { not: null } } })).toBe(0);
  });

  it("taking the mark off never drags the deal back", async () => {
    await signedProposal();
    const file = await markedLenderContract();
    expect((await moveTo(CS)).ok).toBe(true);
    expect((await solar(() => setSignedLenderContractAction({ fileId: file.id, signed: false }))).ok).toBe(true);
    expect((await db.fileAsset.findUniqueOrThrow({ where: { id: file.id } })).documentType).toBeNull();
    expect(await stageKeyOf()).toBe(CS);
  });

  it("a roofing deal's document cannot be marked", async () => {
    const f = await db.fileAsset.create({
      data: {
        companyId, leadId: roofingLeadId, kind: "document", name: "Roofing Contract.pdf", category: "contract",
        storageKey: `test/${randomBytes(8).toString("hex")}.pdf`, mimeType: "application/pdf", size: 10,
      },
      select: { id: true },
    });
    expect((await solar(() => setSignedLenderContractAction({ fileId: f.id, signed: true }))).ok).toBe(false);
  });
});

describe("which template is THE solar contract is chosen on the template", () => {
  const save = (id: string, solarContract: boolean) =>
    solar(() => updateTemplateAction({ id, name: "Utility Authorization", folderKey: "", solarContract }));

  it("ticking it makes that template's completed packages count; unticking stops them", async () => {
    await signedProposal();
    await completedContractPackage(null, { templateId: otherTemplateId });
    expect((await moveTo(CS)).ok).toBe(false);

    expect((await save(otherTemplateId, true)).ok).toBe(true);
    expect((await db.documentTemplate.findUniqueOrThrow({ where: { id: otherTemplateId } })).type).toBe("solar_contract");
    expect((await save(otherTemplateId, false)).ok).toBe(true);
    expect((await db.documentTemplate.findUniqueOrThrow({ where: { id: otherTemplateId } })).type).toBe("custom");
    expect((await moveTo(CS)).ok).toBe(false);

    expect((await save(otherTemplateId, true)).ok).toBe(true);
    expect((await moveTo(CS)).ok).toBe(true);
  });

  it("a sales rep cannot classify a template", async () => {
    actAs("sales_rep");
    expect((await save(otherTemplateId, true)).ok).toBe(false);
    expect((await db.documentTemplate.findUniqueOrThrow({ where: { id: otherTemplateId } })).type).toBe("custom");
  });

  it("a roofing template is never made the solar contract", async () => {
    const roofT = await db.documentTemplate.create({
      data: { companyId, name: "Roofing Agreement", vertical: "roofing", type: "roofing_contract" },
    });
    const res = await runInVertical("roofing", () =>
      updateTemplateAction({ id: roofT.id, name: "Roofing Agreement", folderKey: "", solarContract: true })
    );
    expect(res.ok).toBe(true);
    expect((await db.documentTemplate.findUniqueOrThrow({ where: { id: roofT.id } })).type).toBe("roofing_contract");
  });
});

// ---------------------------------------------------------------------------
// 2. No way around it
// ---------------------------------------------------------------------------

describe("there is no path around it", () => {
  it("jumping straight past the stage is refused too", async () => {
    const res = await moveTo("permitting");
    expect(res.ok).toBe(false);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("renaming the stage changes nothing — the rule never reads the label", async () => {
    await db.pipelineStage.update({ where: { id: stages[CS] }, data: { name: "Signed — waiting on lender" } });
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("a super admin is held to it as well: there is no override", async () => {
    actAs("super_admin");
    expect((await moveTo(CS)).ok).toBe(false);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("the rep who owns the deal is held to it", async () => {
    actAs("sales_rep");
    expect((await moveTo(CS)).ok).toBe(false);
  });

  it("a rep cannot reach somebody else's deal at all", async () => {
    actAs("other_rep");
    await expect(moveTo(CS)).rejects.toThrow(/access denied/i);
  });

  it("another company's stage id is refused before the rule is even asked", async () => {
    const res = await solar(() => moveLeadStage({ leadId, stageId: otherCompanyStageId }));
    expect(res).toEqual({ ok: false, error: "Invalid stage." });
  });

  it("the lead form cannot set the stage directly", async () => {
    const res = await solar(() =>
      updateLeadAction(leadId, { firstName: "Dana", lastName: "Homeowner", stageId: stages[CS] } as never)
    );
    expect(res.ok).toBe(false);
    expect("error" in res && res.error).toMatch(/Contract Signed needs both/);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("an automation cannot move it either — until both documents are on file", async () => {
    const run = () =>
      solar(() => moveStageAction.run({ companyId, vertical: "solar", leadId, config: { stageId: stages[CS] }, depth: 0 }));
    const refused = await run();
    expect(refused.ok).toBe(false);
    expect(refused.detail).toMatch(/Contract Signed needs both/);
    expect(await stageKeyOf()).toBe("proposal_sent");

    await signedProposal();
    await completedContractPackage();
    expect((await run()).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("an automatic re-stage (the appointment date) that would cross it is not applied", async () => {
    const kept = await solar(() =>
      guardedStageId({
        companyId,
        lead: { id: leadId, vertical: "solar", stageId: stages.new_appointment },
        resolvedStageId: stages[CS],
        explicitStageId: null,
      })
    );
    expect(kept).toEqual({ ok: true, stageId: stages.new_appointment });

    const newDeal = await solar(() =>
      guardedStageId({
        companyId,
        lead: { id: null, vertical: "solar", stageId: null },
        resolvedStageId: stages.permitting,
        explicitStageId: null,
        fallbackStageId: stages.new_appointment,
      })
    );
    expect(newDeal).toEqual({ ok: true, stageId: stages.new_appointment });
  });

  it("cancelling is never gated", async () => {
    const res = await solar(() => cancelLeadAction({ leadId, reason: "Customer changed their mind" }));
    expect(res.ok).toBe(true);
    expect(await stageKeyOf()).toBe("cancelled_9");
  });

  it("reopening a cancelled deal past the line has to earn it again", async () => {
    await setStage("cancelled_9");
    expect((await moveTo("permitting")).ok).toBe(false);
  });

  it("a deal already past the line moves on without re-proving anything", async () => {
    await setStage("permitting");
    expect((await moveTo("install_complete")).ok).toBe(true);
  });

  it("roofing is untouched — its Contract Signed stage has no milestone", async () => {
    const res = await runInVertical("roofing", () =>
      moveLeadStage({ leadId: roofingLeadId, stageId: roof.contract_signed })
    );
    expect(res.ok).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 3. It advances by itself when the second document lands
// ---------------------------------------------------------------------------

describe("the deal advances on its own when both documents are on file", () => {
  async function sentProposal() {
    const token = randomBytes(24).toString("base64url");
    await db.solarProposal.create({
      data: { companyId, leadId, version: 1, status: "sent", sentAt: new Date(), publicToken: token, snapshot: SNAPSHOT as never },
    });
    return token;
  }

  it("the customer signing, with the contract already filed, advances it — recorded as the signature", async () => {
    await markedLenderContract();
    const token = await sentProposal();
    expect((await acceptSolarProposal(token, GOOD_SIGNATURE)).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
    expect(await lastEntryVia()).toBe("signature");
  });

  it("the customer signing with NO contract on file does not advance it", async () => {
    const token = await sentProposal();
    expect((await acceptSolarProposal(token, GOOD_SIGNATURE)).ok).toBe(true);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("uploading the Amos contract into Contract does NOT advance it — marking it as the signed contract does", async () => {
    await signedProposal();
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 amos"], "Amos Signed Contract.pdf", { type: "application/pdf" }));
    form.set("leadId", leadId);
    form.set("category", "contract");
    const res = await solar(() => uploadFileAction(form));
    expect(res.ok).toBe(true);
    expect(await stageKeyOf()).toBe("proposal_sent");

    const uploaded = await db.fileAsset.findFirstOrThrow({ where: { leadId, category: "contract" }, select: { id: true } });
    expect((await solar(() => setSignedLenderContractAction({ fileId: uploaded.id, signed: true }))).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
    expect(await lastEntryVia()).toBe("document");
  });

  it("uploading it somewhere else does not", async () => {
    await signedProposal();
    const form = new FormData();
    form.set("file", new File(["%PDF-1.4 amos"], "Amos Signed Contract.pdf", { type: "application/pdf" }));
    form.set("leadId", leadId);
    form.set("category", "personal_files");
    expect((await solar(() => uploadFileAction(form))).ok).toBe(true);
    expect(await stageKeyOf()).toBe("proposal_sent");
  });

  it("refiling the MARKED lender contract into Contract advances it; an unmarked PDF refiled there does not", async () => {
    await signedProposal();
    const plain = await filedDocument("other", { name: "Scan 0042.pdf" });
    expect((await solar(() => moveFileAction(plain.id, "contract"))).ok).toBe(true);
    expect(await stageKeyOf()).toBe("proposal_sent");

    const marked = await markedLenderContract("other");
    expect((await solar(() => moveFileAction(marked.id, "contract"))).ok).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("an e-signed contract completing advances it (the re-evaluation finalizePackage runs)", async () => {
    await signedProposal();
    await completedContractPackage();
    const res = await solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "document" }));
    expect(res.advanced).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("follows the milestone to a renamed stage", async () => {
    await db.pipelineStage.update({ where: { id: stages[CS] }, data: { name: "Sold" } });
    await signedProposal();
    await completedContractPackage();
    expect((await solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "document" }))).advanced).toBe(true);
    expect(await stageKeyOf()).toBe(CS);
  });

  it("never revives a cancelled deal", async () => {
    await setStage("cancelled_9");
    await signedProposal();
    await completedContractPackage();
    expect((await solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "document" }))).advanced).toBe(false);
    expect(await stageKeyOf()).toBe("cancelled_9");
  });

  it("never drags a deal already past the line backwards", async () => {
    await setStage("permitting");
    await signedProposal();
    await completedContractPackage();
    expect((await solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "document" }))).advanced).toBe(false);
    expect(await stageKeyOf()).toBe("permitting");
  });

  it("two documents landing at once advance it exactly once", async () => {
    await signedProposal();
    await completedContractPackage();
    const results = await Promise.all([
      solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "document" })),
      solar(() => advanceToContractSignedIfReady({ companyId, leadId, via: "signature" })),
    ]);
    expect(results.filter((r) => r.advanced)).toHaveLength(1);
    expect(await db.leadStageEvent.count({ where: { leadId, stageId: stages[CS] } })).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// 4. Which stage carries the milestone is itself guarded
// ---------------------------------------------------------------------------

describe("the Contract Signed stage is chosen in Settings, and guarded there", () => {
  it("marking another stage moves the milestone there (one per pipeline)", async () => {
    const res = await solar(() =>
      updatePipelineStageAction(stages.permitting, { name: "Permitting", color: "#A1A1AA", milestone: "contract_signed" })
    );
    expect(res.ok).toBe(true);
    const marked = await db.pipelineStage.findMany({ where: { pipelineId, milestone: "contract_signed" }, select: { id: true } });
    expect(marked.map((s) => s.id)).toEqual([stages.permitting]);
    await db.pipelineStage.update({ where: { id: stages.permitting }, data: { milestone: null } });
  });

  it("a stage edit that does not mention the milestone keeps it", async () => {
    await solar(() => updatePipelineStageAction(stages[CS], { name: "Contract Signed / Hold", color: "#FB923C" }));
    expect((await db.pipelineStage.findUniqueOrThrow({ where: { id: stages[CS] } })).milestone).toBe("contract_signed");
  });

  it("refuses deleting the Contract Signed stage, which would switch the rule off", async () => {
    const res = await solar(() => deletePipelineStageAction(stages[CS]));
    expect(res.ok).toBe(false);
    expect(await db.pipelineStage.count({ where: { id: stages[CS] } })).toBe(1);
  });

  it("refuses making a roofing stage a solar milestone", async () => {
    const res = await runInVertical("roofing", () =>
      updatePipelineStageAction(roof.contract_signed, { name: "Contract Signed", color: "#FB923C", milestone: "contract_signed" })
    );
    expect(res.ok).toBe(false);
  });

  it("refuses the cancelled stage being the milestone", async () => {
    const res = await solar(() =>
      updatePipelineStageAction(stages[CS], { name: "Contract Signed / Hold", color: "#FB923C", isLost: true })
    );
    expect(res.ok).toBe(false);
  });
});
