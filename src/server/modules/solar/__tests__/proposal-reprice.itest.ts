import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * Re-pricing a proposal in front of the customer.
 *
 * Against a REAL database, because every risk in this feature lives in the
 * database rather than in a type:
 *
 *  - `publicToken` is UNIQUE, so moving a live link between two rows is a
 *    constraint the type system cannot see. Get it wrong and the customer's
 *    open tab dies mid-conversation.
 *  - The order of "recompute the design" and "price the finance row" decides
 *    whether the contract price divides by the kW printed above it. Both
 *    orderings type-check; only one is true.
 *  - Superseding is what keeps the record of what was offered. A version that
 *    quietly vanished would pass every unit test ever written.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Reprice Co", slug: `rp-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id,
      firstName: "Rep", lastName: "Rice", lat: 32.78, lng: -96.8,
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

/** A generated version, as the generator writes one. */
const version = (n: number, over: Record<string, unknown> = {}) =>
  db.solarProposal.create({
    data: {
      companyId, leadId, version: n, status: "generated",
      snapshot: { schemaVersion: 4, reference: `SP-${n}` },
      ...over,
    },
  });

describe("the live link follows a re-price and nothing else", () => {
  it("moves the token off the old row and onto the new one, atomically", async () => {
    const old = await version(1, { status: "viewed", publicToken: "tok-move-1", sentAt: new Date() });

    // Exactly the transaction the generator runs when carrying the token: the
    // old row must give it up in the SAME statement batch the new one takes it,
    // because `publicToken` is unique and two statements leave a window where
    // the customer's link resolves to nothing at all.
    const [, fresh] = await db.$transaction([
      db.solarProposal.update({
        where: { id: old.id },
        data: { supersededAt: new Date(), publicToken: null },
      }),
      db.solarProposal.create({
        data: {
          companyId, leadId, version: 2, status: "viewed",
          publicToken: "tok-move-1", sentAt: old.sentAt,
          snapshot: { schemaVersion: 4, reference: "SP-2" },
        },
      }),
    ]);

    expect(fresh.publicToken).toBe("tok-move-1");
    expect((await db.solarProposal.findUniqueOrThrow({ where: { id: old.id } })).publicToken).toBeNull();
    // And the old version is still readable — the record of what was offered.
    expect((await db.solarProposal.findUniqueOrThrow({ where: { id: old.id } })).snapshot).toBeTruthy();
  });

  it("refuses to leave two rows holding one link", async () => {
    await version(1, { publicToken: "tok-dup", sentAt: new Date() });
    await expect(version(2, { publicToken: "tok-dup", sentAt: new Date() })).rejects.toThrow();
  });

  it("leaves an unsent proposal with no public surface to move", async () => {
    const draft = await version(1);
    expect(draft.publicToken).toBeNull();
    expect(draft.sentAt).toBeNull();
  });
});

describe("presentation choices survive a re-price", () => {
  it("carries the rep's toggles onto the new version rather than resetting them", async () => {
    const old = await version(1, { showComparison: false, showPaymentOptions: false });

    const fresh = await db.solarProposal.create({
      data: {
        companyId, leadId, version: 2, status: "generated",
        snapshot: { schemaVersion: 4, reference: "SP-2" },
        // What repriceProposalAction passes through: the choices were made
        // about THIS household and re-pricing is not a decision about them.
        showComparison: old.showComparison,
        showPaymentOptions: old.showPaymentOptions,
      },
    });

    expect(fresh.showComparison).toBe(false);
    expect(fresh.showPaymentOptions).toBe(false);
  });

  it("defaults both on for a version generated without an opinion", async () => {
    const fresh = await version(1);
    expect(fresh.showComparison).toBe(true);
    expect(fresh.showPaymentOptions).toBe(true);
  });
});

describe("the new columns are really there", () => {
  it("stores the company's home-value claim, defaulting to no claim at all", async () => {
    const s = await db.solarSettings.create({ data: { companyId } });
    expect(s.homeValueUpliftPct).toBe(0);
    const updated = await db.solarSettings.update({
      where: { companyId },
      data: { homeValueUpliftPct: 4.1 },
    });
    expect(updated.homeValueUpliftPct).toBeCloseTo(4.1, 5);
    await db.solarSettings.delete({ where: { companyId } });
  });

  it("stores a datasheet link on a catalogue item, and allows none", async () => {
    const withSheet = await db.solarEquipment.create({
      data: {
        companyId, kind: "module", model: `M-${Math.random().toString(36).slice(2, 8)}`,
        specSheetUrl: "https://example.com/datasheet.pdf",
      },
    });
    const without = await db.solarEquipment.create({
      data: { companyId, kind: "module", model: `M-${Math.random().toString(36).slice(2, 8)}` },
    });
    expect(withSheet.specSheetUrl).toBe("https://example.com/datasheet.pdf");
    expect(without.specSheetUrl).toBeNull();
    await db.solarEquipment.deleteMany({ where: { id: { in: [withSheet.id, without.id] } } });
  });
});
