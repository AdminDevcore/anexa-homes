import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * SIGNING COMPLETES THE DOCUMENT WORKFLOW.
 *
 * A customer signing approves their version, and approval is what files the
 * PDF into the deal's Proposal folder. The render boots Chromium, so the
 * signature deliberately does not wait for it — but what filled the gap was a
 * `useEffect` on the deal page that only fires for somebody holding
 * `Settings:update`. A rep opening their own signed deal triggered nothing, and
 * until an admin happened to visit, the deal had a signed proposal and an empty
 * folder.
 *
 * The renderer is MOCKED here. Booting a browser would make this suite depend
 * on a running app and take tens of seconds, and none of what is under test is
 * the render — it is which documents get filed, how many, and what happens when
 * one fails. The render itself is covered by e2e/solar-proposal-print.spec.ts.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";

const renderProposalPdf = vi.hoisted(() => vi.fn());
vi.mock("../proposal-pdf", () => ({ renderProposalPdf }));
vi.mock("@/server/storage", () => ({ putObject: vi.fn(async () => undefined) }));

const { fileApprovedCopy } = await import("../proposal-file-copy");
const { approveProposalVersion } = await import("../proposal-approval");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

/** A document with two honest readings — it earns credits, so it files a pair. */
const SNAPSHOT_PAIR = {
  schemaVersion: 7,
  reference: "SP-FILE",
  customer: { name: "Signed Customer" },
  options: [{ key: "quoted", monthlyCents: 35_578, creditsApplied: { monthlyCents: 17_789 } }],
};
/** One reading only: nothing to claim, so one copy. */
const SNAPSHOT_SINGLE = {
  schemaVersion: 7,
  reference: "SP-FILE",
  customer: { name: "Signed Customer" },
  options: [{ key: "quoted", monthlyCents: 35_578 }],
};

async function signedApproved(over: { pair?: boolean; version?: number } = {}) {
  const p = await db.solarProposal.create({
    data: {
      companyId,
      leadId,
      version: over.version ?? 1,
      status: "signed",
      signedAt: new Date(),
      signerName: "H. Owner",
      signatureData: "data:image/png;base64,AAAA",
      approvedAt: new Date(),
      snapshot: (over.pair === false ? SNAPSHOT_SINGLE : SNAPSHOT_PAIR) as never,
    },
    select: { id: true, leadId: true, version: true },
  });
  return p;
}

const folder = () =>
  db.fileAsset.findMany({
    where: { companyId, leadId, category: "proposal" },
    orderBy: { name: "asc" },
    select: { id: true, name: true, uploadedById: true },
  });

const row = (id: string) =>
  db.solarProposal.findUniqueOrThrow({
    where: { id },
    select: { approvedFileId: true, approvedParFileId: true },
  });

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Filing Co", slug: `file-${process.pid}-${Date.now()}` },
  });
  companyId = company.id;
  const pipeline = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "signed", name: "Contract Signed", position: 5 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
      firstName: "Signed", lastName: "Customer",
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.solarProposal.deleteMany({ where: { companyId } });
  renderProposalPdf.mockReset();
  renderProposalPdf.mockResolvedValue(Buffer.from("%PDF-1.7 pretend"));
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("a signed proposal that earns credits files BOTH readings", () => {
  it("files Proposal and Proposal PAR, named for the version and the customer", async () => {
    const p = await signedApproved();
    const res = await runInVertical("solar", () =>
      fileApprovedCopy({ companyId, userId: null }, p)
    );
    expect(res.error).toBeNull();

    const files = await folder();
    expect(files.map((f) => f.name)).toEqual([
      "Proposal PAR v1 — Signed Customer.pdf",
      "Proposal v1 — Signed Customer.pdf",
    ]);
  });

  it("renders the two readings from the SAME proposal, one with credits applied", async () => {
    const p = await signedApproved();
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));

    expect(renderProposalPdf).toHaveBeenCalledTimes(2);
    const calls = renderProposalPdf.mock.calls;
    expect(calls.every(([id]) => id === p.id)).toBe(true);
    expect(calls.map(([, opts]) => opts.creditsApplied).sort()).toEqual([false, true]);
  });

  it("points the row's two columns at the two files", async () => {
    const p = await signedApproved();
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));

    const r = await row(p.id);
    const files = await folder();
    const byName = new Map(files.map((f) => [f.name, f.id]));
    expect(r.approvedFileId).toBe(byName.get("Proposal v1 — Signed Customer.pdf"));
    expect(r.approvedParFileId).toBe(byName.get("Proposal PAR v1 — Signed Customer.pdf"));
  });

  it("files ONE copy for a document with nothing to claim", async () => {
    const p = await signedApproved({ pair: false });
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));

    const files = await folder();
    expect(files.map((f) => f.name)).toEqual(["Proposal v1 — Signed Customer.pdf"]);
    expect((await row(p.id)).approvedParFileId).toBeNull();
  });

  it("records no uploader when nobody uploaded it", async () => {
    // The sweep is a cron. Inventing a name would put somebody against an act
    // they did not perform.
    const p = await signedApproved();
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    expect((await folder()).every((f) => f.uploadedById === null)).toBe(true);
  });
});

describe("filing twice does not accumulate copies", () => {
  it("replaces rather than appending — no 'Proposal (1).pdf'", async () => {
    const p = await signedApproved();
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    const first = await folder();
    expect(first).toHaveLength(2);

    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    const second = await folder();

    expect(second).toHaveLength(2);
    expect(second.map((f) => f.name)).toEqual(first.map((f) => f.name));
    // …and the row points at the NEW pair, with the old rows gone.
    const r = await row(p.id);
    expect(second.map((f) => f.id).sort()).toEqual(
      [r.approvedFileId, r.approvedParFileId].filter(Boolean).sort()
    );
    expect(first.map((f) => f.id)).not.toEqual(second.map((f) => f.id));
  });

  it("survives being run three times", async () => {
    const p = await signedApproved();
    for (let i = 0; i < 3; i++) {
      await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    }
    expect(await folder()).toHaveLength(2);
  });
});

describe("partial failure leaves nothing inconsistent", () => {
  it("files NEITHER copy when the second render fails", async () => {
    // Both renders complete before anything is written, so the folder can never
    // hold half a pair — which would read as a complete filing.
    const p = await signedApproved();
    renderProposalPdf
      .mockResolvedValueOnce(Buffer.from("%PDF ok"))
      .mockRejectedValueOnce(new Error("Chromium would not start"));

    const res = await runInVertical("solar", () =>
      fileApprovedCopy({ companyId, userId: null }, p)
    );
    expect(res.error).toMatch(/Chromium/);
    expect(await folder()).toHaveLength(0);
    const r = await row(p.id);
    expect(r.approvedFileId).toBeNull();
    expect(r.approvedParFileId).toBeNull();
  });

  it("is recoverable: the next attempt files the pair cleanly", async () => {
    const p = await signedApproved();
    renderProposalPdf.mockRejectedValueOnce(new Error("boom"));
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    expect(await folder()).toHaveLength(0);

    renderProposalPdf.mockResolvedValue(Buffer.from("%PDF-1.7 pretend"));
    const res = await runInVertical("solar", () =>
      fileApprovedCopy({ companyId, userId: null }, p)
    );
    expect(res.error).toBeNull();
    expect(await folder()).toHaveLength(2);
  });

  it("keeps the approval even when the render fails", async () => {
    // Approving is a business decision and must not be blocked by a browser.
    const p = await signedApproved();
    renderProposalPdf.mockRejectedValue(new Error("no browser"));
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));

    const still = await db.solarProposal.findUniqueOrThrow({
      where: { id: p.id },
      select: { approvedAt: true, signedAt: true },
    });
    expect(still.approvedAt).not.toBeNull();
    expect(still.signedAt).not.toBeNull();
  });
});

describe("the state the sweep looks for", () => {
  it("is exactly what a signature leaves behind", async () => {
    // `approveOnSignature` records the decision and leaves both file columns
    // null, because the renderer must not run while the customer waits. That
    // null pair is the sweep's query.
    const p = await db.solarProposal.create({
      data: {
        companyId, leadId, version: 4, status: "signed", signedAt: new Date(),
        snapshot: SNAPSHOT_PAIR as never,
      },
      select: { id: true, leadId: true, version: true },
    });
    await runInVertical("solar", () =>
      approveProposalVersion(
        { companyId, userId: null, fullName: "H. Owner" },
        p,
        "on_signature"
      )
    );

    const r = await db.solarProposal.findUniqueOrThrow({
      where: { id: p.id },
      select: { approvedAt: true, approvedFileId: true, approvedParFileId: true },
    });
    expect(r.approvedAt).not.toBeNull();
    expect(r.approvedFileId).toBeNull();
    expect(r.approvedParFileId).toBeNull();
    expect(await folder()).toHaveLength(0);

    // …and the sweep completes it without anybody opening the deal.
    await runInVertical("solar", () => fileApprovedCopy({ companyId, userId: null }, p));
    expect(await folder()).toHaveLength(2);
  });
});
