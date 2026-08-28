import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { randomBytes } from "node:crypto";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { acceptSolarProposal } from "@/server/modules/solar/proposal-public";
import { certificateFor } from "@/server/modules/solar/proposal-signature";
import { mintWitness } from "@/server/modules/solar/witness";
import { approveProposalVersion } from "@/server/modules/solar/proposal-approval";
import { runInVertical } from "@/server/vertical/context";

/**
 * The lender's requirement, end to end.
 *
 * Amos will not take a proposal the homeowner has not signed, and "signed" to a
 * lender means a document carrying a mark and a record that stands up. The
 * things proved here are the ones a screenshot cannot: that the mark is
 * PERSISTED and reachable, that the certificate reads back the whole trail,
 * that a signature cannot be forged into being witnessed, that signing makes
 * the signed version the approved one, and that a stale unsigned PDF does not
 * stay in the deal's folder pretending to be the signed one.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";
process.env.AUTH_SECRET = "test-secret-for-proposal-signing";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let repId: string;

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

const SNAPSHOT = {
  schemaVersion: 2,
  generatedAt: "2026-08-27T12:00:00.000Z",
  generatedById: null,
  reference: "SP-SIGN-V1",
  customer: { name: "Dana Homeowner", address: "9 Signature Row" },
  company: { name: "Anexa", phone: null, email: null, logoUrl: null, address: null },
  representative: null,
  energy: { utilityProvider: null, ratePlan: null, annualUsageKwh: 14000, avgMonthlyBillCents: 18000, currentAnnualCostCents: 215600 },
  system: { sizeKwDc: 8, year1ProductionKwh: 8282, offsetPct: 59, moduleLabel: null, moduleQty: 20, inverterLabel: null, batteryLabel: null, mountType: "roof", utilityProvider: null, netMeteringProgram: null, tsrfPct: 85, module: null, inverter: null, battery: null },
  layout: null,
  financing: { product: "cash", contractPriceCents: 2800000, grossPpwCents: 350, basePriceCents: 2800000, adderTotalCents: null, finalPpwCents: 350, monthlyPaymentCents: null, rateMillsPerKwh: null, escalatorPct: null, termYears: null, aprPct: null, lender: null, itcEstimateCents: null, itcPct: null, stateIncentiveNote: null },
  savings: { years: [], utilityCostAvoidedCents: 0, solarPaidCents: 0, netSavingsCents: 0, totalSavingsCents: 0, paybackYear: null },
  environmental: { tonsCo2Avoided: 0, treesEquivalent: 0, poundsCoalAvoided: 0, milesNotDriven: 0 },
  assumptions: { derateFactor: 0.84, annualDegradationPct: 0.5, utilityEscalationPct: 3.5, kwhPerKwYear: 1450, utilityMeterFeeCents: 1000, defaultGrossPpwCents: 350, defaultDealerFeePct: 18, minOffsetPct: 0, maxOffsetPct: 150, minPpwCents: 150, maxPpwCents: 800, currentRateMillsPerKwh: 154 },
  disclaimers: { estimate: "y" },
};

async function sentProposal(over: { supersededAt?: Date | null } = {}) {
  const token = randomBytes(24).toString("base64url");
  const p = await db.solarProposal.create({
    data: {
      companyId,
      leadId,
      version: Math.floor(Math.random() * 1_000_000),
      status: "sent",
      sentAt: new Date(),
      publicToken: token,
      supersededAt: over.supersededAt ?? null,
      snapshot: SNAPSHOT as never,
    },
    select: { id: true, publicToken: true },
  });
  return { id: p.id, token: p.publicToken! };
}

/** A PDF sitting in the deal's Proposal folder, as approving one files it. */
async function filedPdf() {
  return db.fileAsset.create({
    data: {
      companyId, leadId, kind: "document", name: "Proposal.pdf",
      storageKey: `test/${randomBytes(8).toString("hex")}.pdf`,
      mimeType: "application/pdf", size: 10, category: "proposal",
    },
    select: { id: true },
  });
}

/** A well-formed remote signature. Each test varies one thing off this. */
const GOOD = {
  name: "Dana Homeowner",
  signature: PNG,
  signatureType: "drawn" as const,
  consentAtMs: Date.now() - 60_000,
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (iPhone)",
};

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Signing Test Co", slug: `sign-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "contract_signed", name: "Contract Signed", position: 2 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Dana", lastName: "Homeowner", email: "dana@example.com",
    },
  });
  leadId = lead.id;
  const rep = await db.user.create({
    data: {
      companyId, email: `rep-${process.pid}@example.com`, passwordHash: "x",
      firstName: "Ray", lastName: "Rep", role: "sales_rep",
    },
  });
  repId = rep.id;
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
  await db.fileAsset.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. The mark reaches the document
// ---------------------------------------------------------------------------

describe("a signature is stored, not just a timestamp", () => {
  it("persists the mark, the name and the evidence", async () => {
    const { id, token } = await sentProposal();
    const res = await acceptSolarProposal(token, GOOD);
    expect(res.ok).toBe(true);
    // The whole record comes back from the action, so the document has its
    // certificate without a refresh — the refresh is what used to write a
    // phantom "opened by the customer" into the trail at the signing second.
    expect(res.certificate?.signature.mark).toBe(PNG);
    expect(res.certificate?.events.map((e) => e.type)).toContain("signed");

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.status).toBe("signed");
    expect(row.signedAt).toBeTruthy();
    expect(row.signatureData).toBe(PNG);
    expect(row.signatureType).toBe("drawn");
    expect(row.signerName).toBe("Dana Homeowner");
    // Copied off the deal at signing time, so the certificate can say where the
    // document was delivered even after the lead's email is edited.
    expect(row.signerEmail).toBe("dana@example.com");
    expect(row.signedIp).toBe("203.0.113.7");
    expect(row.signedUserAgent).toContain("iPhone");
    expect(row.consentAt).toBeTruthy();
  });

  it("records consent BEFORE the signature", async () => {
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, GOOD);
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.consentAt!.getTime()).toBeLessThan(row.signedAt!.getTime());
  });

  it("falls back to server time for a consent the browser could not have given", async () => {
    // The browser's clock is the only thing that knows when the box was ticked
    // and the only thing in the transaction the signer can set freely.
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, { ...GOOD, consentAtMs: Date.now() + 86_400_000 });
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.consentAt!.getTime()).toBeLessThanOrEqual(row.signedAt!.getTime());
  });

  it("tidies the name it puts on the document", async () => {
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, { ...GOOD, name: "  Dana   Q.  Homeowner \n" });
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.signerName).toBe("Dana Q. Homeowner");
  });
});

// ---------------------------------------------------------------------------
// 2. What a public endpoint has to refuse
// ---------------------------------------------------------------------------

describe("the public signing endpoint validates for itself", () => {
  it("refuses an SVG dressed as a signature", async () => {
    const { id, token } = await sentProposal();
    const svg = "data:image/svg+xml;base64," + Buffer.from("<svg/>").toString("base64");
    const res = await acceptSolarProposal(token, { ...GOOD, signature: svg });
    expect(res.ok).toBe(false);
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.signedAt).toBeNull();
  });

  it("refuses a signature with no consent", async () => {
    const { token } = await sentProposal();
    const res = await acceptSolarProposal(token, { ...GOOD, consentAtMs: null });
    expect(res.ok).toBe(false);
  });

  it("refuses a name that is not one", async () => {
    const { token } = await sentProposal();
    expect((await acceptSolarProposal(token, { ...GOOD, name: " " })).ok).toBe(false);
  });

  it("refuses to sign a superseded version", async () => {
    const { token } = await sentProposal({ supersededAt: new Date() });
    const res = await acceptSolarProposal(token, GOOD);
    expect(res.ok).toBe(false);
    expect(res.error).toContain("newer version");
  });

  it("refuses a second signature", async () => {
    const { token } = await sentProposal();
    expect((await acceptSolarProposal(token, GOOD)).ok).toBe(true);
    const again = await acceptSolarProposal(token, { ...GOOD, name: "Someone Else" });
    expect(again.ok).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 3. In person, and the claim that cannot be forged
// ---------------------------------------------------------------------------

describe("in-person signing", () => {
  it("records the rep whose device was used", async () => {
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, { ...GOOD, witness: mintWitness(id, repId) });
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.signedVia).toBe("in_person");
    expect(row.signedHostId).toBe(repId);
  });

  it("falls back to remote when the token is forged, not to an error", async () => {
    // The customer really did sign. A bad token means the weaker provable
    // claim gets recorded — it must never cost the signature.
    const { id, token } = await sentProposal();
    const res = await acceptSolarProposal(token, { ...GOOD, witness: "not-a-real-token" });
    expect(res.ok).toBe(true);
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.signedVia).toBe("remote");
    expect(row.signedHostId).toBeNull();
  });

  it("will not accept another proposal's witness token", async () => {
    const other = await sentProposal();
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, { ...GOOD, witness: mintWitness(other.id, repId) });
    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.signedVia).toBe("remote");
  });
});

// ---------------------------------------------------------------------------
// 4. The certificate
// ---------------------------------------------------------------------------

describe("the certificate", () => {
  it("is null until the proposal is signed", async () => {
    const { id } = await sentProposal();
    expect(await certificateFor(id)).toBeNull();
  });

  it("reads back the signer, the trail and a fingerprint of what was signed", async () => {
    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, { ...GOOD, witness: mintWitness(id, repId) });

    const cert = await certificateFor(id);
    expect(cert).not.toBeNull();
    expect(cert!.signature.name).toBe("Dana Homeowner");
    expect(cert!.signature.mark).toBe(PNG);
    expect(cert!.signature.via).toBe("in_person");
    expect(cert!.signature.hostName).toBe("Ray Rep");
    expect(cert!.customerName).toBe("Dana Homeowner");
    expect(cert!.propertyAddress).toBe("9 Signature Row");
    expect(cert!.ip).toBe("203.0.113.7");
    expect(cert!.fingerprint).toMatch(/^[0-9a-f]{64}$/);
    expect(cert!.events.map((e) => e.type)).toContain("signed");
  });
});

// ---------------------------------------------------------------------------
// 5. Approval follows the signature
// ---------------------------------------------------------------------------

/**
 * The lender's document and the deal's record are the same document.
 *
 * Approval used to be a press somebody had to remember, and the press came
 * late or never. What the customer signed is not a judgement call, so signing
 * now makes the record itself — including over an earlier approval, which was
 * a guess about a document nobody had signed yet.
 */
describe("approval follows the signature", () => {
  it("makes the signed version the approved one", async () => {
    const { id, token } = await sentProposal();

    await acceptSolarProposal(token, GOOD);

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    expect(row.approvedAt).not.toBeNull();
    // Nobody pressed anything, so there is no user to name — the list reads a
    // null approver as "approved on signature".
    expect(row.approvedById).toBeNull();
    const event = await db.solarProposalEvent.findFirst({
      where: { proposalId: id, type: "approved" },
    });
    expect(event?.actorName).toBe("Dana Homeowner");
  });

  it("takes the approval off a version approved by hand, and its filed copy with it", async () => {
    const earlier = await sentProposal();
    const file = await filedPdf();
    await db.solarProposal.update({
      where: { id: earlier.id },
      data: { approvedAt: new Date(), approvedById: repId, approvedFileId: file.id },
    });

    const { id, token } = await sentProposal();
    await acceptSolarProposal(token, GOOD);

    const signed = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    const dropped = await db.solarProposal.findUniqueOrThrow({ where: { id: earlier.id } });
    expect(signed.approvedAt).not.toBeNull();
    expect(dropped.approvedAt).toBeNull();
    expect(dropped.approvedById).toBeNull();
    // The unsigned PDF of the version nobody signed does not stay in the
    // folder — that is the document the lender would have been handed.
    expect(await db.fileAsset.findUnique({ where: { id: file.id } })).toBeNull();
  });

  it("leaves the approval where a person put it afterwards", async () => {
    // The override is one-way in time. Nothing re-runs after signing, so an
    // admin who then approves a different version by hand keeps the last word.
    const { token } = await sentProposal();
    await acceptSolarProposal(token, GOOD);
    const other = await sentProposal();

    await runInVertical("solar", () =>
      approveProposalVersion(
        { companyId, userId: repId, fullName: "Ray Rep" },
        { id: other.id, leadId, version: 0 },
      )
    );

    const approved = await db.solarProposal.findMany({
      where: { companyId, leadId, approvedAt: { not: null } },
      select: { id: true, approvedById: true },
    });
    expect(approved).toHaveLength(1);
    expect(approved[0].id).toBe(other.id);
    expect(approved[0].approvedById).toBe(repId);
  });
});

// ---------------------------------------------------------------------------
// 6. The filed copy
// ---------------------------------------------------------------------------

describe("the copy filed on the deal", () => {
  it("does not stay in the folder as an unsigned PDF of a signed proposal", async () => {
    const { id, token } = await sentProposal();
    const file = await filedPdf();
    await db.solarProposal.update({
      where: { id },
      data: { approvedAt: new Date(), approvedFileId: file.id },
    });

    await acceptSolarProposal(token, GOOD);

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id } });
    // Still the approved version — signing does not un-decide what was sold.
    expect(row.approvedAt).not.toBeNull();
    // But the pre-signature PDF is gone, so the row reads "Copy not filed" and
    // one press of Retry re-renders it with the signature and the certificate.
    expect(row.approvedFileId).toBeNull();
    expect(await db.fileAsset.findUnique({ where: { id: file.id } })).toBeNull();
  });
});
