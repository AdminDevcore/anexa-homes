import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { runInVertical } from "@/server/vertical/context";
import type { SessionUser } from "@/server/auth/session";

/**
 * THE PAYMENT MENU IS WHAT THE REP TICKED — through the real action, the real
 * generator and a real database.
 *
 * The defect: a rep quoted an Axess PPA, ticked nothing else on the Financing
 * step, and the customer's proposal still listed "Pay in full" and an Amos
 * loan. The ticks lived only in the browser; generation offered cash plus one
 * programme from every active lender regardless.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const requireUser = vi.hoisted(() => vi.fn());
vi.mock("@/server/auth/session", () => ({ requireUser }));

const { generateProposalVersion } = await import("../proposal-generate");
const { setSolarShortlistAction } = await import("../actions");

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const inSolar = <T>(fn: () => Promise<T>) => runInVertical("solar", fn);

let companyId: string;
let leadId: string;
let user: SessionUser;
let quotedId: string;
let amosId: string;
let climateId: string;

const generate = () => inSolar(() => generateProposalVersion(user, leadId));

async function tick(ids: string[]) {
  await db.solarFinance.update({ where: { leadId }, data: { shortlistIds: ids } });
}

beforeAll(async () => {
  const stamp = `${process.pid}-${Date.now()}`;
  const company = await db.company.create({
    data: {
      name: "Menu Shortlist Test Co",
      slug: `menu-${stamp}`,
      phone: "(866) 650-9996",
      email: "support@example.com",
      address: "1 Test Way",
      city: "Dallas",
      state: "TX",
      zip: "75001",
    },
  });
  companyId = company.id;

  const owner = await db.user.create({
    data: {
      companyId,
      email: `owner-${stamp}@example.com`,
      firstName: "Ola",
      lastName: "Owner",
      role: "super_admin",
    },
  });
  user = {
    userId: owner.id,
    companyId,
    role: "super_admin",
    fullName: "Ola Owner",
    permissions: {},
  } as unknown as SessionUser;
  requireUser.mockResolvedValue(user);

  const pipeline = await db.pipeline.create({
    data: { companyId, name: "Solar", vertical: "solar" },
  });
  const stage = await db.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await db.lead.create({
    data: {
      companyId,
      vertical: "solar",
      pipelineId: pipeline.id,
      stageId: stage.id,
      firstName: "Dana",
      lastName: "Ortiz",
      address: "18 Menu Row",
      city: "Dallas",
      state: "TX",
      zip: "75201",
      lat: 32.78,
      lng: -96.8,
    },
  });
  leadId = lead.id;

  const panel = await db.solarEquipment.create({
    data: {
      companyId,
      kind: "module",
      manufacturer: "Qcells",
      model: `Q.PEAK-${stamp}`,
      ratingW: 400,
      widthMm: 1134,
      heightMm: 1879,
    },
  });

  const lender = (name: string, rank: number) =>
    db.solarLender.create({ data: { companyId, name, rank }, select: { id: true } }).then((r) => r.id);
  const loan = (lenderId: string, name: string) =>
    db.solarLenderProduct
      .create({
        data: { companyId, lenderId, product: "loan", name, aprPct: 3.99, termMonths: 300, dealerFeePct: 25 },
        select: { id: true },
      })
      .then((r) => r.id);

  const axess = await lender("Axess", 0);
  quotedId = await loan(axess, "25 yr");
  amosId = await loan(await lender("Amos Capital Fund", 1), "30 Year Solar");
  climateId = await loan(await lender("Climate First", 2), "20 yr");

  await db.solarDesign.create({
    data: {
      companyId,
      leadId,
      lenderId: axess,
      systemType: "pv",
      moduleId: panel.id,
      moduleQty: 25,
      systemSizeKwDc: 10,
      year1ProductionKwh: 12_180,
      annualUsageKwh: 13_000,
      offsetPct: 93,
      avgMonthlyBillCents: 21_000,
      utilityRateMills: 150,
      utilityProvider: "Oncor",
      layoutImageFileId: "00000000-0000-0000-0000-000000000001",
    },
  });

  await db.solarFinance.create({
    data: {
      companyId,
      leadId,
      product: "loan",
      lenderProductId: quotedId,
      grossPpwCents: 400,
      dealerFeePct: 25,
      contractPriceCents: 40_000_00,
      aprPct: 3.99,
      loanTermMonths: 300,
    },
  });
});

beforeEach(async () => {
  await db.solarProposal.deleteMany({ where: { companyId } });
  await tick([]);
});

afterAll(async () => {
  await db.company.deleteMany({ where: { id: companyId } });
  await db.$disconnect();
});

describe("ticking a card saves it on the deal", () => {
  it("stores the ticked cards, cash included", async () => {
    const res = await inSolar(() => setSolarShortlistAction({ leadId, ids: ["cash", amosId] }));
    expect(res.ok).toBe(true);
    const row = await db.solarFinance.findUniqueOrThrow({ where: { leadId }, select: { shortlistIds: true } });
    expect(row.shortlistIds).toEqual(["cash", amosId]);
  });

  it("drops an id that is not on this company's rate sheet", async () => {
    await inSolar(() => setSolarShortlistAction({ leadId, ids: [climateId, "not-a-programme"] }));
    const row = await db.solarFinance.findUniqueOrThrow({ where: { leadId }, select: { shortlistIds: true } });
    expect(row.shortlistIds).toEqual([climateId]);
  });
});

describe("the proposal offers only what was ticked", () => {
  it("offers the quote alone when nothing else was ticked", async () => {
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect((res.snapshot.options ?? []).map((o) => o.key)).toEqual(["quoted:loan"]);
  });

  it("offers cash and Amos when those were ticked, and not Climate First", async () => {
    await tick(["cash", amosId]);
    const res = await generate();
    if (!res.ok) throw new Error(res.error);
    expect((res.snapshot.options ?? []).map((o) => o.key)).toEqual([
      "quoted:loan",
      "cash",
      `loan:${amosId}`,
    ]);
  });
});
