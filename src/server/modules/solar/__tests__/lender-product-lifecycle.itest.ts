import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * What happens to a quoted deal when its rate sheet changes underneath it.
 *
 * The whole risk lives in foreign-key behaviour rather than in any type, so
 * these run against a real database:
 *
 *  - `solar_finance.lenderProductId` is ON DELETE SET NULL, so deleting a
 *    product does NOT fail loudly. It quietly cuts every deal quoted from it
 *    loose from the terms it was priced on. That is what the delete guard in
 *    the action exists to prevent, and what retiring does instead.
 *  - `solar_lender_products.lenderId` is ON DELETE CASCADE, because a rate
 *    sheet means nothing without its lender — unlike a DESIGN built for that
 *    lender, which has to survive.
 */
process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let leadId: string;
let lenderId: string;

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Rate Sheet Co", slug: `rs-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const pipe = await db.pipeline.create({ data: { companyId, name: "Solar", vertical: "solar" } });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipe.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId, vertical: "solar", pipelineId: pipe.id, stageId: stage.id,
      firstName: "Rate", lastName: "Sheet",
    },
  });
  leadId = lead.id;
});

beforeEach(async () => {
  await db.solarFinance.deleteMany({ where: { companyId } });
  await db.solarLender.deleteMany({ where: { companyId } });
  const l = await db.solarLender.create({ data: { companyId, name: "Credit Human" } });
  lenderId = l.id;
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

const loanProduct = (over: Record<string, unknown> = {}) =>
  db.solarLenderProduct.create({
    data: {
      companyId, lenderId, product: "loan",
      aprPct: 4.99, termMonths: 300, dealerFeePct: 18,
      ...over,
    },
  });

const quote = (lenderProductId: string) =>
  db.solarFinance.create({
    data: {
      companyId, leadId, product: "loan", lenderProductId,
      grossPpwCents: 350, dealerFeePct: 18, aprPct: 4.99, loanTermMonths: 300,
    },
  });

describe("a lender's rate sheet over time", () => {
  it("retiring leaves every quoted deal exactly as it was", async () => {
    const p = await loanProduct();
    await quote(p.id);

    await db.solarLenderProduct.update({ where: { id: p.id }, data: { isActive: false } });

    const f = await db.solarFinance.findUnique({ where: { leadId } });
    expect(f?.lenderProductId).toBe(p.id);
    expect(f?.aprPct).toBe(4.99);
    expect(f?.dealerFeePct).toBe(18);
  });

  it("deleting a quoted product silently orphans the deal — which is why the action refuses", async () => {
    const p = await loanProduct();
    await quote(p.id);

    // No error. This is the whole point: the database will happily do it.
    await db.solarLenderProduct.delete({ where: { id: p.id } });

    const f = await db.solarFinance.findUnique({ where: { leadId } });
    expect(f).not.toBeNull();
    expect(f?.lenderProductId).toBeNull();
    // The terms survive as copies, but nothing now says where they came from.
    expect(f?.aprPct).toBe(4.99);
  });

  it("counts the deals a delete would orphan, which is what the guard reads", async () => {
    const p = await loanProduct();
    await quote(p.id);
    const inUse = await db.solarFinance.count({ where: { companyId, lenderProductId: p.id } });
    expect(inUse).toBe(1);
  });

  it("takes the rate sheet with the lender, but never the deal", async () => {
    const p = await loanProduct();
    await quote(p.id);

    await db.solarLender.delete({ where: { id: lenderId } });

    expect(await db.solarLenderProduct.findUnique({ where: { id: p.id } })).toBeNull();
    const f = await db.solarFinance.findUnique({ where: { leadId } });
    expect(f).not.toBeNull();
    expect(f?.contractPriceCents).toBeDefined();
  });

  it("keeps several products on one lender, each priced separately", async () => {
    await loanProduct({ aprPct: 4.99, dealerFeePct: 18 });
    await loanProduct({ aprPct: 3.99, dealerFeePct: 28 });
    const rows = await db.solarLenderProduct.findMany({
      where: { lenderId },
      orderBy: { aprPct: "asc" },
    });
    expect(rows.map((r) => [r.aprPct, r.dealerFeePct])).toEqual([
      [3.99, 28],
      [4.99, 18],
    ]);
  });
});
