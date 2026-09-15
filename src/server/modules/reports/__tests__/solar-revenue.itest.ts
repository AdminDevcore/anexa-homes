import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * SOLAR REVENUE IS THE CONTRACT, NEVER THE AFTER-CREDIT NET.
 *
 * The defect: every revenue surface reads `Project.contractValue`, which was
 * written once at Project creation from `Lead.claimPrice ?? Lead.value` — and
 * on solar `Lead.value` is deliberately the household's NET after the federal
 * credits their document quotes. So a $56,000 contract was booked as $39,200
 * of revenue, exactly $56,000 x 0.70, on the rep scorecard, the dashboard, the
 * financial summary and every other Project-based report.
 *
 * A tax credit is claimed by the homeowner on their own federal return months
 * later. It is not a discount the company gave and it never reduces what the
 * company is owed.
 *
 * The second half of the same defect: a solar deal is SOLD before it has a
 * job. Between the signature and "Start production" there is no Project at
 * all, so the deal counted as won and contributed $0.
 *
 * These are DB-backed because the bug lived in the denormalisation, not in the
 * arithmetic — the pure side is proved in lib/__tests__/solar-deal-value.test.ts.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const { restampLeadValue } = await import("@/server/modules/solar/deal-value");
const { solarContractByLead, dealRevenueCents } = await import("../solar-contract");

// Unextended: this client builds fixtures. The code under test is what has to
// survive the vertical extension, hence the runInVertical wrappers below.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

const CONTRACT = 5_600_000; // $56,000 — what the household signed
const NET_AFTER_ITC = 3_920_000; // $39,200 — the same deal less a 30% credit

let companyId: string;
let pipelineId: string;
let soldStageId: string;
let openStageId: string;

/** A frozen document quoting `CONTRACT` with a 30% credit ladder under it. */
const snapshotFor = (contractCents: number, netCents: number | null) => ({
  schemaVersion: 7,
  reference: "SP-REV",
  customer: { name: "Revenue Test" },
  system: { sizeKwDc: 16, moduleQty: 40, year1ProductionKwh: 18_514, offsetPct: 100 },
  financing: {
    product: "loan",
    contractPriceCents: contractCents,
    monthlyPaymentCents: null,
    rateMillsPerKwh: null,
    ...(netCents == null ? {} : { creditLadder: { netCostCents: netCents } }),
  },
});

async function makeSolarLead(opts: {
  name: string;
  sold: boolean;
  contractCents?: number | null;
  netCents?: number | null;
  withProject?: boolean;
  product?: "loan" | "cash" | "lease" | "ppa";
}) {
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId,
      stageId: opts.sold ? soldStageId : openStageId,
      firstName: opts.name,
      lastName: "Solar",
      // The wrong figure, as production had it: the net, stamped at creation.
      value: opts.netCents ?? 0,
    },
    select: { id: true },
  });

  if (opts.contractCents != null) {
    const snap = snapshotFor(opts.contractCents, opts.netCents ?? null);
    if (opts.product && opts.product !== "loan") {
      (snap.financing as Record<string, unknown>).product = opts.product;
      if (opts.product === "lease" || opts.product === "ppa") {
        (snap.financing as Record<string, unknown>).contractPriceCents = null;
      }
    }
    await db.solarProposal.create({
      data: {
        companyId,
        leadId: lead.id,
        version: 1,
        status: "signed",
        approvedAt: new Date(),
        snapshot: snap as never,
      },
    });
  }

  if (opts.withProject) {
    await db.project.create({
      data: {
        companyId,
        vertical: "solar",
        leadId: lead.id,
        projectNumber: `REV-${opts.name}-${Date.now()}`,
        // Exactly what `ensureProjectForLeadAction` stamps on creation.
        contractValue: opts.netCents ?? 0,
      },
    });
  }
  return lead.id;
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Solar Revenue Co", slug: `rev-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  pipelineId = pipeline.id;
  const open = await db.pipelineStage.create({
    data: { pipelineId, key: "qualified", name: "Qualified", position: 1 },
  });
  openStageId = open.id;
  const sold = await db.pipelineStage.create({
    data: {
      pipelineId,
      key: "contract_signed",
      name: "Contract Signed",
      position: 5,
      countsAsSold: true,
    },
  });
  soldStageId = sold.id;
});

beforeEach(async () => {
  await db.project.deleteMany({ where: { companyId } });
  await db.solarProposal.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("a $56,000 solar contract is $56,000 of revenue", () => {
  it("re-stamps the job's contract off the reported proposal, not the net", async () => {
    const leadId = await makeSolarLead({
      name: "WithJob",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
      withProject: true,
    });

    // As production had it before the fix.
    const before = await db.project.findFirstOrThrow({ where: { leadId } });
    expect(before.contractValue).toBe(NET_AFTER_ITC);

    await runInVertical("solar", () => restampLeadValue(companyId, leadId));

    const after = await db.project.findFirstOrThrow({ where: { leadId } });
    expect(after.contractValue).toBe(CONTRACT);
    // …and the 0.70 relationship is gone, which is the shape of the bug.
    expect(after.contractValue).not.toBe(Math.round(CONTRACT * 0.7));
  });

  it("leaves Lead.value as the household's net — the two answers stay distinct", async () => {
    const leadId = await makeSolarLead({
      name: "TwoAnswers",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
      withProject: true,
    });
    await runInVertical("solar", () => restampLeadValue(companyId, leadId));

    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    const project = await db.project.findFirstOrThrow({ where: { leadId } });
    expect(lead.value).toBe(NET_AFTER_ITC); // pipeline card: what they pay
    expect(project.contractValue).toBe(CONTRACT); // revenue: what they owe
  });

  it("books a sold solar deal that has no job yet", async () => {
    // The gap between signing and "Start production": no Project exists, so
    // every Project-based revenue query summed nothing for a deal that is won.
    const leadId = await makeSolarLead({
      name: "NoJob",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
      withProject: false,
    });

    const map = await runInVertical("solar", () => solarContractByLead(companyId, [leadId]));
    expect(map.get(leadId)).toBe(CONTRACT);
  });

  it("prefers the job's own figure once production has started", async () => {
    // An admin can correct the contract by hand on the Edit Job dialog, and a
    // hand correction has to stick rather than being re-derived away.
    expect(dealRevenueCents({ projectContractCents: 4_000_000, solarContractCents: CONTRACT }))
      .toBe(4_000_000);
    expect(dealRevenueCents({ projectContractCents: null, solarContractCents: CONTRACT }))
      .toBe(CONTRACT);
    expect(dealRevenueCents({ projectContractCents: null, solarContractCents: null })).toBe(0);
  });

  it("books a cash deal at its contract, exactly like a financed one", async () => {
    const leadId = await makeSolarLead({
      name: "Cash",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
      product: "cash",
    });
    const map = await runInVertical("solar", () => solarContractByLead(companyId, [leadId]));
    expect(map.get(leadId)).toBe(CONTRACT);
  });

  it("books the contract whether or not the document quotes a credit", async () => {
    const withItc = await makeSolarLead({
      name: "ItcShown",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
    });
    const noItc = await makeSolarLead({
      name: "ItcHidden",
      sold: true,
      contractCents: CONTRACT,
      netCents: null, // nothing claimed — no ladder on the document at all
    });
    const map = await runInVertical("solar", () =>
      solarContractByLead(companyId, [withItc, noItc])
    );
    expect(map.get(withItc)).toBe(CONTRACT);
    expect(map.get(noItc)).toBe(CONTRACT);
  });

  it("books nothing on a lease or a PPA — no system was bought", async () => {
    const lease = await makeSolarLead({
      name: "Lease",
      sold: true,
      contractCents: CONTRACT,
      product: "lease",
    });
    const ppa = await makeSolarLead({
      name: "Ppa",
      sold: true,
      contractCents: CONTRACT,
      product: "ppa",
    });
    const map = await runInVertical("solar", () => solarContractByLead(companyId, [lease, ppa]));
    expect(map.get(lease)).toBeUndefined();
    expect(map.get(ppa)).toBeUndefined();
  });

  it("books nothing for a deal nobody has quoted", async () => {
    const leadId = await makeSolarLead({ name: "Unquoted", sold: true, contractCents: null });
    const map = await runInVertical("solar", () => solarContractByLead(companyId, [leadId]));
    expect(map.get(leadId)).toBeUndefined();
    // …and the re-stamp leaves an unproposed job alone rather than zeroing it.
    await runInVertical("solar", () => restampLeadValue(companyId, leadId));
    expect(await db.project.count({ where: { leadId } })).toBe(0);
  });

  it("reports the APPROVED version, not merely the newest", async () => {
    const leadId = await makeSolarLead({
      name: "Versions",
      sold: true,
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
      withProject: true,
    });
    // A later draft exploring a bigger array must not restate the deal.
    await db.solarProposal.create({
      data: {
        companyId,
        leadId,
        version: 2,
        status: "generated",
        snapshot: snapshotFor(9_900_000, 6_930_000) as never,
      },
    });

    const map = await runInVertical("solar", () => solarContractByLead(companyId, [leadId]));
    expect(map.get(leadId)).toBe(CONTRACT);

    await runInVertical("solar", () => restampLeadValue(companyId, leadId));
    const project = await db.project.findFirstOrThrow({ where: { leadId } });
    expect(project.contractValue).toBe(CONTRACT);
  });

  it("does not touch a roofing job's contract", async () => {
    // The column is roofing's and its meaning there is unchanged.
    const roofPipeline = await db.pipeline.create({
      data: { companyId, name: "Roofing", vertical: "roofing" },
    });
    const roofStage = await db.pipelineStage.create({
      data: { pipelineId: roofPipeline.id, key: "signed", name: "Signed", position: 1 },
    });
    const roofLead = await db.lead.create({
      data: {
        companyId,
        vertical: "roofing",
        pipelineId: roofPipeline.id,
        stageId: roofStage.id,
        firstName: "Roof",
        lastName: "Job",
        value: 2_500_000,
      },
    });
    await db.project.create({
      data: {
        companyId,
        vertical: "roofing",
        leadId: roofLead.id,
        projectNumber: `ROOF-${Date.now()}`,
        contractValue: 2_500_000,
      },
    });

    // The solar re-stamp is scoped to solar jobs and must not reach this one.
    await runInVertical("solar", () => restampLeadValue(companyId, roofLead.id));
    const project = await db.project.findFirstOrThrow({ where: { leadId: roofLead.id } });
    expect(project.contractValue).toBe(2_500_000);
  });

  it("ignores a cancelled deal's proposal only where the caller does", async () => {
    // `solarContractByLead` answers what a deal contracted for; deciding
    // whether a cancelled deal still counts is the report's own filter (the
    // sale line excludes lost stages). Proved here so the split is explicit.
    const leadId = await makeSolarLead({
      name: "Cancelled",
      sold: false, // sitting in an open stage, i.e. outside the sale line
      contractCents: CONTRACT,
      netCents: NET_AFTER_ITC,
    });
    const map = await runInVertical("solar", () => solarContractByLead(companyId, [leadId]));
    // It has a contract…
    expect(map.get(leadId)).toBe(CONTRACT);
    // …and the report's own sale-line filter is what keeps it out of revenue.
    const lead = await db.lead.findUniqueOrThrow({ where: { id: leadId } });
    expect(lead.stageId).toBe(openStageId);
  });
});
