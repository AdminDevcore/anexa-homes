import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * WHICH DOCUMENT THE LENDER IS TOLD ABOUT.
 *
 * The bug these exist for is invisible in a unit test, because it is a bug
 * about which ROW a query returns. A household signs v13; the rep then builds a
 * v14. `mayInheritLiveLink` deliberately leaves the customer's live link on the
 * signed v13, and an ordinary generate mints no token for v14 at all — so the
 * only document the household can open is one that is now superseded.
 *
 * Two things went wrong there and only one of them was visible. Qualify refused
 * outright, telling them to open "the most recent one your representative sent
 * you" — a document that exists at no address. And underneath, the money and
 * the savings analysis were resolved as "the newest version that is not
 * superseded", so had it NOT refused, v14's price would have gone to an
 * underwriter under a signature given for v13's.
 *
 * These drive `readLenderSubmission`, which is the read-only half of the same
 * resolution the submission uses — same `submissionDocument`, same figures, no
 * network.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const decryptField = vi.hoisted(() => vi.fn(() => "ak_live_secret"));
vi.mock("@/server/lib/crypto", () => ({
  decryptField,
  encryptField: (v: string) => v,
  maskTail: () => "MASKED",
}));

const { readLenderSubmission } = await import("../lender-submit");

// Unextended on purpose — this client builds fixtures. The code under test is
// what has to survive the vertical extension, hence `inSolar` around every call.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

let companyId: string;
let leadId: string;
let otherLeadId: string;

/** A document quoting one amount over one term, with a savings analysis. */
function snapshot(amountCents: number, termMonths: number) {
  return {
    schemaVersion: 2,
    financing: { financedAmountCents: amountCents, loanTermMonths: termMonths },
    system: { year1ProductionKwh: 17107 },
    energy: { annualUsageKwh: 16017 },
    assumptions: { currentRateMillsPerKwh: 233 },
    savings: {
      years: [{ year: 1, utilityCostCents: 373196, residualGridCents: 0, meterFeeCents: 12000 }],
    },
  };
}

async function version(
  v: number,
  amountCents: number,
  over: { supersededAt?: Date | null; signedAt?: Date | null; approvedAt?: Date | null; leadId?: string } = {},
) {
  return db.solarProposal.create({
    data: {
      companyId,
      leadId: over.leadId ?? leadId,
      version: v,
      status: "generated",
      supersededAt: over.supersededAt ?? null,
      signedAt: over.signedAt ?? null,
      approvedAt: over.approvedAt ?? null,
      snapshot: snapshot(amountCents, 300) as never,
    },
    select: { id: true, version: true },
  });
}

/** What the button resolves to, ready or not. */
const submission = (proposalId?: string | null) =>
  inSolar(() => readLenderSubmission(leadId, companyId, proposalId));

/** The amount on the summary the button shows, which is the amount that is sent. */
async function financingLine(proposalId?: string | null) {
  const status = await submission(proposalId);
  if (status.mode !== "api" || !status.ready) {
    throw new Error(`not submittable: ${JSON.stringify(status)}`);
  }
  return status.summary.financing;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Submission Doc Co", slug: `subdoc-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Dana", lastName: "Reyes", email: "dana@example.com", phone: "5125550143",
      address: "4120 Sage Hollow Dr", city: "Austin", state: "TX", zip: "78735",
    },
  });
  leadId = lead.id;
  const other = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Someone", lastName: "Else",
    },
  });
  otherLeadId = other.id;

  const lender = await db.solarLender.create({
    data: {
      companyId, name: "Amos Capital Fund",
      apiBaseUrl: "https://lender.test",
      apiKeyEncrypted: "ENCRYPTED",
      apiProductSlug: "solar-installation-financing",
    },
  });
  const panel = await db.solarEquipment.create({
    data: { companyId, kind: "module", manufacturer: "Qcells", model: "Q.PEAK 410", ratingW: 410 },
  });
  const inverter = await db.solarEquipment.create({
    data: { companyId, kind: "inverter", manufacturer: "Enphase", model: "IQ8PLUS" },
  });
  for (const equipmentId of [panel.id, inverter.id]) {
    await db.solarEquipmentLender.create({
      data: { equipmentId, lenderId: lender.id, lenderBrand: "Qcells", lenderModel: "MAPPED" },
    });
  }
  await db.solarDesign.create({
    data: {
      companyId, leadId, lenderId: lender.id,
      moduleId: panel.id, inverterId: inverter.id,
      moduleQty: 26, batteryQty: 0,
      systemSizeKwDc: 10.66, year1ProductionKwh: 14200, annualUsageKwh: 15800,
    },
  });
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("the document a submission speaks for", () => {
  it("quotes the version that was NAMED, not the newest one", async () => {
    // The shape the customer is left in: signed v13, superseded behind their
    // back by a v14 they have never been sent.
    const v13 = await version(13, 48_750_00, {
      signedAt: new Date("2026-09-04"),
      supersededAt: new Date("2026-09-05"),
    });
    await version(14, 61_000_00);

    expect(await financingLine(v13.id)).toContain("$48,750");
  });

  it("would otherwise have sent the unsigned newer price", async () => {
    // The same fixture read WITHOUT naming a document, and with nothing
    // approved: this is what every submission used to resolve to.
    await version(13, 48_750_00, {
      signedAt: new Date("2026-09-04"),
      supersededAt: new Date("2026-09-05"),
    });
    await version(14, 61_000_00);

    expect(await financingLine()).toContain("$61,000");
  });

  it("falls back to the version this deal SOLD at, over a newer draft", async () => {
    // Signing approves the version automatically, so this is the ordinary
    // shape of a signed deal — and the fallback now honours it.
    await version(13, 48_750_00, {
      signedAt: new Date("2026-09-04"),
      approvedAt: new Date("2026-09-04"),
      supersededAt: new Date("2026-09-05"),
    });
    await version(14, 61_000_00);

    expect(await financingLine()).toContain("$48,750");
  });

  it("falls back to the current version when nothing has been approved", async () => {
    // Unchanged behaviour, and the reason the old rule looked right: a deal
    // still being worked has no agreed version, so the newest live one is it.
    await version(12, 52_000_00, { supersededAt: new Date("2026-09-01") });
    await version(13, 55_500_00);

    expect(await financingLine()).toContain("$55,500");
  });

  it("refuses an id that belongs to another deal rather than quoting a substitute", async () => {
    // The id reaches the resolver from a caller, so it is scoped to the lead
    // AND the company and resolves to nothing when it is neither. Nothing is
    // then what the submission is built from — it does NOT quietly fall back to
    // this deal's own document, because sending a price nobody asked for is the
    // failure mode the whole change is about.
    const foreign = await version(1, 99_000_00, { leadId: otherLeadId });
    await version(13, 55_500_00);

    const status = await submission(foreign.id);
    expect(status).toMatchObject({ mode: "api", ready: false });
    // And the deal itself is fine — it is only that id that resolves to nothing.
    expect(await financingLine()).toContain("$55,500");
  });
});
