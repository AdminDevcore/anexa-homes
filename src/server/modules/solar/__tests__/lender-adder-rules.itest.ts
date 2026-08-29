import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import {
  financedOnTopFor,
  lenderAdderRules,
  lineFromCatalogue,
  restampAddersForLender,
} from "@/server/modules/solar/adders";

/**
 * Which extra work rides ON TOP of a partner's price, lender by lender.
 *
 * `SolarEquipment.financedOnTop` answered this once for everybody, which was
 * right while exactly one partner priced this way: Amos Capital Fund funds a
 * flat $5.50/W and a roof above it at what the roof costs, so the roof got the
 * tick. It stops being right the moment a second capped partner rolls the same
 * roof into the same ceiling -- the tick is on the catalogue and the catalogue
 * is one list shared by every lender you sell.
 *
 * Against a real database because the whole behaviour is the fallback: absent
 * row means "ask the catalogue" and a stored `false` means "no, not on this
 * partner", and those are two states one boolean column cannot hold.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let amosId: string;
let otherId: string;
/** A roof: on top of a fixed price by the catalogue's own reckoning. */
let roofId: string;
/** A main panel upgrade: inside the price, everywhere, until told otherwise. */
let mpuId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Lender Adder Co", slug: `lar-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id, firstName: "Ad", lastName: "Test" },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarDealAdder.deleteMany({ where: { companyId } });
  await db.solarDesign.deleteMany({ where: { companyId } });
  await db.solarLenderAdderRule.deleteMany({ where: { lender: { companyId } } });
  await db.solarLender.deleteMany({ where: { companyId } });
  await db.solarEquipment.deleteMany({ where: { companyId } });

  amosId = (
    await db.solarLender.create({
      data: { companyId, name: "Amos Capital Fund", maxFinalPpwCents: 550, finalPpwMode: "flat" },
    })
  ).id;
  otherId = (
    await db.solarLender.create({
      data: { companyId, name: "Climate First", maxFinalPpwCents: 600, finalPpwMode: "cap" },
    })
  ).id;
  roofId = (
    await db.solarEquipment.create({
      data: {
        companyId, kind: "adder", model: "Re-roof", adderBasis: "flat",
        priceCents: 7_000_00, financedOnTop: true,
      },
    })
  ).id;
  mpuId = (
    await db.solarEquipment.create({
      data: {
        companyId, kind: "adder", model: "Main panel upgrade", adderBasis: "flat",
        priceCents: 2_700_00, financedOnTop: false,
      },
    })
  ).id;
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const rule = (lenderId: string, equipmentId: string, financedOnTop: boolean) =>
  db.solarLenderAdderRule.create({ data: { lenderId, equipmentId, financedOnTop } });

/**
 * `SolarEquipment` is a vertical-scoped model, so the resolver reads the
 * catalogue through the extension and needs an active workspace. Every real
 * caller has one -- these are portal actions -- so the wrapper is the test
 * supplying what a session already would.
 */
const restamp = (lenderId: string | null) =>
  runInVertical("solar", () => restampAddersForLender(companyId, leadId, lenderId));

describe("the catalogue answers until a lender overrules it", () => {
  it("a lender with no rules quotes exactly what the catalogue says", async () => {
    const rules = await lenderAdderRules(amosId);
    expect(rules.size).toBe(0);
    expect(financedOnTopFor(rules, roofId, true)).toBe(true);
    expect(financedOnTopFor(rules, mpuId, false)).toBe(false);
  });

  it("a cash deal has no lender to ask, and falls back the same way", async () => {
    const rules = await lenderAdderRules(null);
    expect(financedOnTopFor(rules, roofId, true)).toBe(true);
  });

  /**
   * The case the whole table exists for. A stored `false` has to beat a
   * catalogue `true` -- a second capped partner that funds the roof out of its
   * own ceiling cannot be expressed by a table of only the ticked ones.
   */
  it("a stored `false` overrides a catalogue that says on top", async () => {
    await rule(otherId, roofId, false);
    expect(financedOnTopFor(await lenderAdderRules(otherId), roofId, true)).toBe(false);
    // ...and the OTHER lender is untouched by it.
    expect(financedOnTopFor(await lenderAdderRules(amosId), roofId, true)).toBe(true);
  });

  it("a stored `true` overrides a catalogue that says inside the price", async () => {
    await rule(amosId, mpuId, true);
    expect(financedOnTopFor(await lenderAdderRules(amosId), mpuId, false)).toBe(true);
  });

  it("a hand-typed line, which has no catalogue row, keeps its own answer", async () => {
    const rules = await lenderAdderRules(amosId);
    expect(financedOnTopFor(rules, null, true)).toBe(true);
    expect(financedOnTopFor(rules, null, false)).toBe(false);
  });
});

describe("a line picked onto a deal is stamped with the lender's answer", () => {
  it("lineFromCatalogue takes the rule over the catalogue", async () => {
    await rule(otherId, roofId, false);
    const item = await db.solarEquipment.findUniqueOrThrow({ where: { id: roofId } });
    expect(lineFromCatalogue(item).financedOnTop).toBe(true);
    expect(lineFromCatalogue(item, await lenderAdderRules(otherId)).financedOnTop).toBe(false);
  });
});

describe("moving a deal to another partner re-reads that partner's rules", () => {
  const putRoofOnDeal = (financedOnTop: boolean) =>
    db.solarDealAdder.create({
      data: {
        companyId, leadId, equipmentId: roofId, label: "Re-roof",
        basis: "flat", flatCents: 7_000_00, qty: 1, financedOnTop,
      },
    });

  it("a roof quoted on top comes back inside the price on a partner that says so", async () => {
    await putRoofOnDeal(true);
    await rule(otherId, roofId, false);

    expect(await restamp(otherId)).toBe(1);
    const line = await db.solarDealAdder.findFirstOrThrow({ where: { leadId, equipmentId: roofId } });
    expect(line.financedOnTop).toBe(false);
  });

  it("and back on top again when the deal moves to the partner that funds it that way", async () => {
    await putRoofOnDeal(false);
    await rule(otherId, roofId, false);

    // Amos has no rule, so the catalogue answers -- and the catalogue says on top.
    expect(await restamp(amosId)).toBe(1);
    const line = await db.solarDealAdder.findFirstOrThrow({ where: { leadId, equipmentId: roofId } });
    expect(line.financedOnTop).toBe(true);
  });

  it("reports nothing moved when the new partner agrees with the old one", async () => {
    await putRoofOnDeal(true);
    expect(await restamp(amosId)).toBe(0);
  });

  /**
   * A rep who ticks "on top" on a one-off they typed is the only person who can
   * have meant it: there is no catalogue row for a lender to hold an opinion
   * about, so nothing may quietly reverse them.
   */
  it("never touches a hand-typed line", async () => {
    await db.solarDealAdder.create({
      data: {
        companyId, leadId, equipmentId: null, label: "Tree removal",
        basis: "custom", flatCents: 900_00, qty: 1, financedOnTop: true,
      },
    });
    expect(await restamp(otherId)).toBe(0);
    const line = await db.solarDealAdder.findFirstOrThrow({ where: { leadId, equipmentId: null } });
    expect(line.financedOnTop).toBe(true);
  });

  /**
   * A line whose catalogue row has been deleted has no fallback left. Its own
   * stored flag is the only surviving record of what it was sold as, so it is
   * left holding it rather than reset to false by an absent row.
   */
  it("leaves a line alone when its catalogue row is gone", async () => {
    await putRoofOnDeal(true);
    await db.solarDealAdder.updateMany({ where: { leadId }, data: { equipmentId: mpuId } });
    await db.solarEquipment.delete({ where: { id: mpuId } });

    expect(await restamp(otherId)).toBe(0);
    const line = await db.solarDealAdder.findFirstOrThrow({ where: { leadId } });
    expect(line.financedOnTop).toBe(true);
  });

  it("clearing the lender puts every line back on the catalogue's answer", async () => {
    await putRoofOnDeal(false);
    expect(await restamp(null)).toBe(1);
    const line = await db.solarDealAdder.findFirstOrThrow({ where: { leadId } });
    expect(line.financedOnTop).toBe(true);
  });
});

describe("deleting either end takes the rule with it", () => {
  it("retiring a lender's row cascades its adder rules away", async () => {
    await rule(otherId, roofId, false);
    await db.solarLender.delete({ where: { id: otherId } });
    expect(await db.solarLenderAdderRule.count({ where: { lenderId: otherId } })).toBe(0);
  });

  it("deleting a catalogue adder cascades every lender's rule about it", async () => {
    await rule(amosId, mpuId, true);
    await rule(otherId, mpuId, false);
    await db.solarEquipment.delete({ where: { id: mpuId } });
    expect(await db.solarLenderAdderRule.count({ where: { equipmentId: mpuId } })).toBe(0);
  });
});
