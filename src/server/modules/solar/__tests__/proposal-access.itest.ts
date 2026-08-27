import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { getPublicSolarProposal, recordProposalView } from "@/server/modules/solar/proposal-public";
import {
  LAYOUT_CATEGORY,
  pruneSupersededLayouts,
  resolveLayoutAsset,
} from "@/server/modules/solar/layout-asset";
import { DESIGNER_LAYOUT_FILENAME } from "@/lib/solar-layout";
import { objectExists, putObject } from "@/server/storage";
import { randomBytes } from "node:crypto";

/**
 * Two safety guarantees that only a real database can demonstrate.
 *
 * 1. GENERATING A PROPOSAL CREATES NO PUBLIC SURFACE.
 *    Generation used to mint a live share token as a side effect, so every
 *    draft anyone had ever previewed was already reachable on the open
 *    internet. Nobody had to click "share" for that to be true. A token is now
 *    minted on SEND, and the public read ALSO checks status — so even a token
 *    left behind by the old behaviour, a restored backup or a hand-written
 *    UPDATE does not open the door.
 *
 * 2. A MISSING LAYOUT FILE NEVER REACHES A CUSTOMER AS A BROKEN IMAGE.
 *    A FileAsset row and the bytes behind it are different things and drift
 *    apart. Both are checked, independently.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";

// Unextended client on purpose: these tests are about the ACCESS gate, not the
// vertical extension, and the public read path runs unscoped anyway.
const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

const SNAPSHOT = (layoutFileId?: string) => ({
  schemaVersion: 2,
  generatedAt: "2026-08-16T12:00:00.000Z",
  generatedById: null,
  reference: "SP-TEST-V1",
  customer: { name: "Test Customer", address: "1 Test Way" },
  company: { name: "Anexa", phone: null, email: null, logoUrl: null, address: null },
  representative: null,
  energy: { utilityProvider: null, ratePlan: null, annualUsageKwh: 14000, avgMonthlyBillCents: 18000, currentAnnualCostCents: 215600 },
  system: { sizeKwDc: 8, year1ProductionKwh: 8282, offsetPct: 59.16, moduleLabel: null, moduleQty: 20, inverterLabel: null, batteryLabel: null, mountType: "roof", utilityProvider: null, netMeteringProgram: null, tsrfPct: 85, module: null, inverter: null, battery: null },
  layout: layoutFileId ? { fileId: layoutFileId, provider: null, externalRef: null, preliminary: true } : null,
  financing: { product: "cash", contractPriceCents: 2800000, grossPpwCents: 350, basePriceCents: 2800000, adderTotalCents: null, finalPpwCents: 350, monthlyPaymentCents: null, rateMillsPerKwh: null, escalatorPct: null, termYears: null, aprPct: null, lender: null, itcEstimateCents: null, itcPct: null, stateIncentiveNote: null },
  savings: { years: [], utilityCostAvoidedCents: 0, solarPaidCents: 0, netSavingsCents: 0, totalSavingsCents: 0, paybackYear: null },
  environmental: { tonsCo2Avoided: 0, treesEquivalent: 0, poundsCoalAvoided: 0, milesNotDriven: 0 },
  assumptions: { derateFactor: 0.84, annualDegradationPct: 0.5, utilityEscalationPct: 3.5, kwhPerKwYear: 1450, utilityMeterFeeCents: 1000, defaultGrossPpwCents: 350, defaultDealerFeePct: 18, minOffsetPct: 0, maxOffsetPct: 150, minPpwCents: 150, maxPpwCents: 800, currentRateMillsPerKwh: 154 },
  disclaimers: { estimate: "y" },
});

async function makeProposal(over: {
  status?: "draft" | "generated" | "sent" | "viewed" | "signed";
  publicToken?: string | null;
  sentAt?: Date | null;
  layoutFileId?: string;
  version?: number;
}) {
  return db.solarProposal.create({
    data: {
      companyId,
      leadId,
      version: over.version ?? Math.floor(Math.random() * 1_000_000),
      status: over.status ?? "generated",
      publicToken: over.publicToken === undefined ? null : over.publicToken,
      sentAt: over.sentAt ?? null,
      snapshot: SNAPSHOT(over.layoutFileId) as never,
    },
    select: { id: true, publicToken: true },
  });
}

beforeAll(async () => {
  const company = await db.company.create({
    data: { name: "Access Test Co", slug: `acc-${process.pid}-${Date.now()}` },
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
      firstName: "Access", lastName: "Test",
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

// ---------------------------------------------------------------------------
// 1. Public access
// ---------------------------------------------------------------------------

describe("an unsent proposal has no public surface", () => {
  it("a GENERATED proposal has no token at all", async () => {
    const p = await makeProposal({ status: "generated" });
    expect(p.publicToken).toBeNull();
  });

  it("refuses a GENERATED proposal even when a token somehow exists", async () => {
    // The exact leak this closes: tokens minted by the old behaviour, restored
    // backups, a hand-written UPDATE. A token is not authorization.
    const token = randomBytes(24).toString("base64url");
    await makeProposal({ status: "generated", publicToken: token, sentAt: null });
    expect(await getPublicSolarProposal(token)).toBeNull();
  });

  it("refuses a DRAFT proposal carrying a token", async () => {
    const token = randomBytes(24).toString("base64url");
    await makeProposal({ status: "draft", publicToken: token, sentAt: null });
    expect(await getPublicSolarProposal(token)).toBeNull();
  });

  it("refuses a proposal whose status says sent but which was never actually sent", async () => {
    // status and sentAt are written together; either being wrong closes the door.
    const token = randomBytes(24).toString("base64url");
    await makeProposal({ status: "sent", publicToken: token, sentAt: null });
    expect(await getPublicSolarProposal(token)).toBeNull();
  });

  it("ALLOWS a genuinely sent proposal", async () => {
    const token = randomBytes(24).toString("base64url");
    await makeProposal({ status: "sent", publicToken: token, sentAt: new Date() });
    const got = await getPublicSolarProposal(token);
    expect(got).not.toBeNull();
    expect(got!.snapshot.reference).toBe("SP-TEST-V1");
  });

  it("keeps allowing it once viewed or signed", async () => {
    for (const status of ["viewed", "signed"] as const) {
      const token = randomBytes(24).toString("base64url");
      await makeProposal({ status, publicToken: token, sentAt: new Date() });
      expect(await getPublicSolarProposal(token)).not.toBeNull();
    }
  });

  it("refuses an empty or unknown token without touching anything", async () => {
    expect(await getPublicSolarProposal("")).toBeNull();
    expect(await getPublicSolarProposal("not-a-real-token")).toBeNull();
  });

  it("never marks an unsent proposal as viewed", async () => {
    // recordProposalView runs on every public page load. If it could act on a
    // generated proposal, an internal preview would destroy the one signal that
    // says whether the customer actually opened the document.
    const token = randomBytes(24).toString("base64url");
    const p = await makeProposal({ status: "generated", publicToken: token, sentAt: null });
    await recordProposalView(token, null);
    const after = await db.solarProposal.findUniqueOrThrow({
      where: { id: p.id },
      select: { status: true, viewedAt: true },
    });
    expect(after.status).toBe("generated");
    expect(after.viewedAt).toBeNull();
  });

  it("tokens are unique and unguessable, and many unsent rows coexist at NULL", async () => {
    // Postgres treats NULLs as distinct, which is what lets every unsent
    // proposal sit at NULL under a UNIQUE index.
    await Promise.all([1, 2, 3].map((v) => makeProposal({ version: v, publicToken: null })));
    const nulls = await db.solarProposal.count({ where: { companyId, publicToken: null } });
    expect(nulls).toBe(3);

    const a = randomBytes(24).toString("base64url");
    await makeProposal({ version: 10, status: "sent", publicToken: a, sentAt: new Date() });
    expect(a.length).toBeGreaterThanOrEqual(32);
    await expect(
      makeProposal({ version: 11, status: "sent", publicToken: a, sentAt: new Date() })
    ).rejects.toThrow();
  });
});

// ---------------------------------------------------------------------------
// 2. Missing layout file
// ---------------------------------------------------------------------------

describe("a layout is only rendered when it can actually be fetched", () => {
  async function makeFile(withBytes: boolean) {
    const key = `test/layout-${randomBytes(6).toString("hex")}.jpg`;
    if (withBytes) await putObject(key, Buffer.from("not-really-a-jpeg-but-nonzero"));
    return db.fileAsset.create({
      data: {
        companyId, leadId, kind: "photo", name: "layout.jpg",
        storageKey: key, mimeType: "image/jpeg", size: 28,
      },
      select: { id: true, storageKey: true },
    });
  }

  it("VALID: file row and bytes both present", async () => {
    const f = await makeFile(true);
    expect(await resolveLayoutAsset(companyId, leadId, f.id)).not.toBeNull();
  });

  it("MISSING FILEASSET: the row was deleted from Documents", async () => {
    const f = await makeFile(true);
    await db.fileAsset.delete({ where: { id: f.id } });
    expect(await resolveLayoutAsset(companyId, leadId, f.id)).toBeNull();
  });

  it("OBJECT UNAVAILABLE: the row survives but the bytes are gone", async () => {
    // A bucket lifecycle rule, or a database restored without its storage. The
    // row alone would have said "yes" and produced a broken image.
    const f = await makeFile(false);
    expect(await resolveLayoutAsset(companyId, leadId, f.id)).toBeNull();
  });

  it("LAYOUT REMOVED AFTER DRAFT: the design no longer points at anything", async () => {
    expect(await resolveLayoutAsset(companyId, leadId, null)).toBeNull();
    expect(await resolveLayoutAsset(companyId, leadId, undefined)).toBeNull();
  });

  it("PREVIOUSLY GENERATED PROPOSAL whose layout has since gone resolves to nothing", async () => {
    const f = await makeFile(true);
    const p = await makeProposal({
      status: "sent", publicToken: randomBytes(24).toString("base64url"),
      sentAt: new Date(), layoutFileId: f.id,
    });
    // The frozen snapshot still names the file...
    const before = await db.solarProposal.findUniqueOrThrow({ where: { id: p.id }, select: { snapshot: true } });
    const snapLayout = (before.snapshot as { layout?: { fileId: string } }).layout;
    expect(snapLayout?.fileId).toBe(f.id);

    // ...but once the file is gone, the renderer is handed nothing and omits
    // the whole section. The snapshot is NOT rewritten: it is a record of what
    // was offered, not a cache.
    await db.fileAsset.delete({ where: { id: f.id } });
    expect(await resolveLayoutAsset(companyId, leadId, snapLayout!.fileId)).toBeNull();
    const after = await db.solarProposal.findUniqueOrThrow({ where: { id: p.id }, select: { snapshot: true } });
    expect((after.snapshot as { layout?: { fileId: string } }).layout?.fileId).toBe(f.id);
  });

  it("does not resolve a file belonging to another deal or company", async () => {
    const f = await makeFile(true);
    expect(await resolveLayoutAsset(companyId, "some-other-lead", f.id)).toBeNull();
    expect(await resolveLayoutAsset("some-other-company", leadId, f.id)).toBeNull();
  });

  it("resolving never deletes the FileAsset it was asked about", async () => {
    // The file may be mid-restore. Unlinking a rep's upload because storage
    // hiccuped would destroy work nobody asked us to touch.
    const f = await makeFile(false);
    expect(await resolveLayoutAsset(companyId, leadId, f.id)).toBeNull();
    expect(await db.fileAsset.findUnique({ where: { id: f.id } })).not.toBeNull();
  });
});

// ---------------------------------------------------------------------------
// 3. Superseded layout drawings
// ---------------------------------------------------------------------------

/**
 * The designer re-renders its picture of the array and files it as a NEW
 * FileAsset on every save, then re-points the design at it. Nothing ever
 * pointed at the copy before, so a roof drawn eight times left eight
 * near-identical aerials on the deal.
 *
 * Pruning them is a delete, so what it must NEVER take is the interesting part:
 * the current drawing, anything a proposal froze into its snapshot, and
 * anything a rep uploaded themselves.
 */
describe("superseded panel layouts are pruned, but only the safe ones", () => {
  async function makeLayout(name = DESIGNER_LAYOUT_FILENAME, lead = leadId, company = companyId) {
    const key = `test/prune-${randomBytes(6).toString("hex")}.jpg`;
    await putObject(key, Buffer.from("not-really-a-jpeg-but-nonzero"));
    return db.fileAsset.create({
      data: {
        companyId: company, leadId: lead, kind: "photo", name,
        category: LAYOUT_CATEGORY, storageKey: key, mimeType: "image/jpeg", size: 28,
      },
      select: { id: true, storageKey: true },
    });
  }

  const alive = async (id: string) =>
    (await db.fileAsset.findUnique({ where: { id }, select: { id: true } })) !== null;

  beforeEach(async () => {
    await db.fileAsset.deleteMany({ where: { companyId } });
  });

  it("drops the drawings the deal has outgrown and keeps the current one", async () => {
    const old1 = await makeLayout();
    const old2 = await makeLayout();
    const current = await makeLayout();

    expect(await pruneSupersededLayouts(companyId, leadId, current.id)).toBe(2);
    expect(await alive(old1.id)).toBe(false);
    expect(await alive(old2.id)).toBe(false);
    expect(await alive(current.id)).toBe(true);
  });

  it("keeps a drawing frozen into a SENT proposal — the customer's link reads that row", async () => {
    // serveLayoutImage looks the file up by snapshot.layout.fileId. Delete the
    // row and the homeowner's proposal loses its picture.
    const old = await makeLayout();
    const current = await makeLayout();
    await makeProposal({ status: "sent", sentAt: new Date(), layoutFileId: old.id });

    expect(await pruneSupersededLayouts(companyId, leadId, current.id)).toBe(0);
    expect(await alive(old.id)).toBe(true);
  });

  it("keeps one frozen into an UNSENT proposal too — a draft can still be sent", async () => {
    const old = await makeLayout();
    const current = await makeLayout();
    await makeProposal({ status: "draft", layoutFileId: old.id });

    expect(await pruneSupersededLayouts(companyId, leadId, current.id)).toBe(0);
    expect(await alive(old.id)).toBe(true);
  });

  it("never touches a layout the rep uploaded by hand", async () => {
    // Same category, same folder, different thing entirely: an export from
    // another design tool. Replacing it is not permission to delete it.
    const theirs = await makeLayout("aurora-export.png");
    const current = await makeLayout();

    expect(await pruneSupersededLayouts(companyId, leadId, current.id)).toBe(0);
    expect(await alive(theirs.id)).toBe(true);
  });

  it("stays inside the deal it was asked about", async () => {
    const pipeline = await db.pipeline.findFirstOrThrow({ where: { companyId } });
    const stage = await db.pipelineStage.findFirstOrThrow({ where: { pipelineId: pipeline.id } });
    const other = await db.lead.create({
      data: {
        companyId, vertical: "solar", pipelineId: pipeline.id, stageId: stage.id,
        firstName: "Other", lastName: "Deal",
      },
      select: { id: true },
    });
    const theirs = await makeLayout(DESIGNER_LAYOUT_FILENAME, other.id);
    const mine = await makeLayout();
    const current = await makeLayout();

    expect(await pruneSupersededLayouts(companyId, leadId, current.id)).toBe(1);
    expect(await alive(mine.id)).toBe(false);
    expect(await alive(theirs.id)).toBe(true);

    await db.fileAsset.deleteMany({ where: { leadId: other.id } });
    await db.lead.delete({ where: { id: other.id } });
  });

  it("deletes the ROW and leaves the bytes in storage", async () => {
    // Same rule as removeFiledCopies and deleteFileAction: a prune we get wrong
    // should cost a database row, never the picture itself.
    const old = await makeLayout();
    const current = await makeLayout();
    await pruneSupersededLayouts(companyId, leadId, current.id);

    expect(await alive(old.id)).toBe(false);
    expect(await objectExists(old.storageKey)).toBe(true);
  });

  it("does nothing on a deal with a single drawing", async () => {
    const only = await makeLayout();
    expect(await pruneSupersededLayouts(companyId, leadId, only.id)).toBe(0);
    expect(await alive(only.id)).toBe(true);
  });
});
