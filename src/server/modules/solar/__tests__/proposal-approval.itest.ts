import { describe, it, expect, beforeAll, beforeEach, afterAll, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";

/**
 * Approving one version out of many, and the copy that files itself when you
 * do.
 *
 * TWO STEPS, exactly as production runs them. `approveProposalVersion` records
 * the decision; the copy is filed by a separate POST to
 * api/solar/proposals/[id]/file-copy, which calls `fileApprovedCopy`. The split
 * is what keeps a 66MB browser out of the pages that host the button, and it is
 * also what makes a failed render survivable — so the tests below approve and
 * file as two calls rather than pretending they are one.
 *
 * The renderer itself is MOCKED. Booting Chromium and navigating to a running
 * app would make this suite depend on a dev server and take tens of seconds,
 * and none of what is under test here is the render — it is the swap, the
 * folder and the constraint. The render has its own end-to-end proof in
 * e2e/solar-proposal-print.spec.ts.
 */

const renderProposalPdf = vi.hoisted(() => vi.fn());
vi.mock("../proposal-pdf", () => ({ renderProposalPdf }));

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";

const { approveProposalVersion, unapproveProposalVersion } =
  await import("../proposal-approval");
const { fileApprovedCopy } = await import("../proposal-file-copy");

// Unextended on purpose: this client builds fixtures, and the code under test
// is what has to survive the vertical extension — see the runInVertical wrapper
// around every call below.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let actor: { companyId: string; userId: string; fullName: string };

const SNAPSHOT = { schemaVersion: 2, reference: "SP-TEST", customer: { name: "T" } };

async function makeVersion(version: number, over: { supersededAt?: Date } = {}) {
  return db.solarProposal.create({
    data: {
      companyId,
      leadId,
      version,
      status: "generated",
      supersededAt: over.supersededAt ?? null,
      snapshot: SNAPSHOT as never,
    },
    select: { id: true, leadId: true, version: true, approvedFileId: true },
  });
}

/** Every call under test runs the way a server action does: inside a workspace. */
const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

/** Approve, then file — the pair the UI performs back to back. */
async function approveAndFile(p: { id: string; leadId: string; version: number }) {
  await inSolar(() => approveProposalVersion(actor, p));
  return inSolar(() => fileApprovedCopy(actor, p));
}

async function proposalFolder() {
  return db.fileAsset.findMany({
    where: { companyId, leadId, category: "proposal" },
    select: { id: true, name: true, mimeType: true, size: true },
  });
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Approval Test Co", slug: `appr-${process.pid}-${Date.now()}` },
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
      firstName: "Approval", lastName: "Test",
    },
  });
  leadId = lead.id;
  const user = await db.user.create({
    data: {
      companyId, email: `approver-${process.pid}@test.local`,
      firstName: "Ada", lastName: "Admin", role: "admin", passwordHash: "x",
    },
  });
  actor = { companyId, userId: user.id, fullName: "Ada Admin" };
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

describe("approving one version", () => {
  it("marks it approved and files a PDF into the Proposal folder", async () => {
    const v1 = await makeVersion(1);
    const out = await approveAndFile(v1);

    expect(out.error).toBeNull();
    expect(out.fileId).toBeTruthy();

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    expect(row.approvedAt).not.toBeNull();
    expect(row.approvedById).toBe(actor.userId);
    expect(row.approvedFileId).toBe(out.fileId);

    // The folder that has been defined and empty since the grid shipped.
    const folder = await proposalFolder();
    expect(folder).toHaveLength(1);
    expect(folder[0].id).toBe(out.fileId);
    expect(folder[0].mimeType).toBe("application/pdf");
    expect(folder[0].name).toBe("Proposal v1 — Approval Test.pdf");
    expect(folder[0].size).toBeGreaterThan(0);
  });

  it("approves a SUPERSEDED version — the common case, not an edge one", async () => {
    // The agreed proposal is routinely not the last one generated: a rep runs
    // three more scenarios after the handshake. A rule that only the current
    // version may be approved could not record what actually happened.
    const v7 = await makeVersion(7, { supersededAt: new Date() });
    await makeVersion(10);

    const out = await approveAndFile(v7);
    expect(out.error).toBeNull();

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id: v7.id } });
    expect(row.approvedAt).not.toBeNull();
    expect(row.supersededAt).not.toBeNull();
  });

  it("writes an audit event and an activity entry", async () => {
    const v1 = await makeVersion(1);
    await inSolar(() => approveProposalVersion(actor, v1));

    const events = await db.solarProposalEvent.findMany({ where: { proposalId: v1.id } });
    expect(events.map((e) => e.type)).toContain("approved");

    const log = await db.activityLog.findMany({ where: { companyId, leadId } });
    expect(log.some((l) => l.message.includes("approved solar proposal v1"))).toBe(true);
  });
});

describe("only one version may be approved", () => {
  it("approving a second one releases the first and swaps the filed copy", async () => {
    const v1 = await makeVersion(1);
    const v2 = await makeVersion(2);

    const first = await approveAndFile(v1);
    const second = await approveAndFile(v2);

    const rows = await db.solarProposal.findMany({
      where: { leadId }, select: { version: true, approvedAt: true },
    });
    expect(rows.filter((r) => r.approvedAt).map((r) => r.version)).toEqual([2]);

    // Exactly one copy in the folder, and it is the new one. The old file row
    // is gone rather than left behind as a second "the proposal we sold".
    const folder = await proposalFolder();
    expect(folder).toHaveLength(1);
    expect(folder[0].id).toBe(second.fileId);
    expect(folder.map((f) => f.id)).not.toContain(first.fileId);
  });

  it("the database refuses a second approved version, not just the code", async () => {
    // The partial unique index. Two admins approving different versions in the
    // same second is a lost race; without this it is a deal with two finals.
    const v1 = await makeVersion(1);
    const v2 = await makeVersion(2);
    await inSolar(() => approveProposalVersion(actor, v1));

    await expect(
      db.solarProposal.update({
        where: { id: v2.id },
        data: { approvedAt: new Date(), approvedById: actor.userId },
      })
    ).rejects.toThrow();
  });

  it("lets two different deals each have their own approved version", async () => {
    // The index is partial on leadId, so it must not collapse to one approved
    // proposal per company.
    const other = await db.lead.create({
      data: {
        companyId, vertical: "solar",
        pipelineId: (await db.pipeline.findFirstOrThrow({ where: { companyId } })).id,
        stageId: (await db.pipelineStage.findFirstOrThrow({})).id,
        firstName: "Second", lastName: "Deal",
      },
    });
    const mine = await makeVersion(1);
    const theirs = await db.solarProposal.create({
      data: { companyId, leadId: other.id, version: 1, status: "generated", snapshot: SNAPSHOT as never },
      select: { id: true, leadId: true, version: true },
    });

    await approveAndFile(mine);
    await approveAndFile(theirs);

    const approved = await db.solarProposal.findMany({
      where: { companyId, approvedAt: { not: null } }, select: { id: true },
    });
    expect(approved).toHaveLength(2);

    await db.lead.delete({ where: { id: other.id } });
  });
});

describe("unapproving", () => {
  it("clears the mark and takes the copy out of the folder", async () => {
    const v1 = await makeVersion(1);
    await approveAndFile(v1);

    const withFile = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    await inSolar(() => unapproveProposalVersion(actor, { ...v1, approvedFileId: withFile.approvedFileId }));

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    expect(row.approvedAt).toBeNull();
    expect(row.approvedById).toBeNull();
    expect(row.approvedFileId).toBeNull();
    expect(await proposalFolder()).toHaveLength(0);
  });

  it("frees the slot so another version can be approved", async () => {
    const v1 = await makeVersion(1);
    const v2 = await makeVersion(2);
    await approveAndFile(v1);
    const f = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    await inSolar(() => unapproveProposalVersion(actor, { ...v1, approvedFileId: f.approvedFileId }));

    const out = await approveAndFile(v2);
    expect(out.error).toBeNull();
    const rows = await db.solarProposal.findMany({ where: { leadId }, select: { version: true, approvedAt: true } });
    expect(rows.filter((r) => r.approvedAt).map((r) => r.version)).toEqual([2]);
  });
});

describe("a failed render does not block the decision", () => {
  it("approves anyway, and says the copy was not filed", async () => {
    renderProposalPdf.mockRejectedValue(new Error("Could not find Chrome"));
    const v1 = await makeVersion(1);

    const approval = await inSolar(() => approveProposalVersion(actor, v1));
    const filed = await inSolar(() => fileApprovedCopy(actor, v1));

    expect(approval.approved).toBe(true);
    expect(filed.fileId).toBeNull();
    expect(filed.error).toMatch(/Chrome/);

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    expect(row.approvedAt).not.toBeNull();
    expect(row.approvedFileId).toBeNull();
    expect(await proposalFolder()).toHaveLength(0);
  });

  it("retrying files the copy without approving anything twice", async () => {
    renderProposalPdf.mockRejectedValueOnce(new Error("Could not find Chrome"));
    const v1 = await makeVersion(1);
    await approveAndFile(v1);

    renderProposalPdf.mockResolvedValue(Buffer.from("%PDF-1.7 retried"));
    const retry = await inSolar(() => fileApprovedCopy(actor, v1));

    expect(retry.error).toBeNull();
    const folder = await proposalFolder();
    expect(folder).toHaveLength(1);
    expect(folder[0].id).toBe(retry.fileId);

    const row = await db.solarProposal.findUniqueOrThrow({ where: { id: v1.id } });
    expect(row.approvedFileId).toBe(retry.fileId);
  });

  it("a second retry replaces the copy rather than stacking another one", async () => {
    const v1 = await makeVersion(1);
    await approveAndFile(v1);
    await inSolar(() => fileApprovedCopy(actor, v1));

    expect(await proposalFolder()).toHaveLength(1);
  });
});
