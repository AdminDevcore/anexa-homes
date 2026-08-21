import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { verticalExtension } from "@/server/vertical/extension";
import { runUnscoped } from "@/server/vertical/context";
import { computeCommissionsForProject } from "@/server/modules/payroll/engine";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A solar deal has to actually pay somebody.
 *
 * Before this engine existed it paid nobody: the roofing path builds its profit
 * pool from `Project.contractValue`, nothing ever writes a solar deal's price
 * onto its Project, and a pool of zero pays the rep, every manager and every
 * override exactly nothing — silently, because $0 is a perfectly valid amount.
 *
 * What is under test:
 *   • the redline pays the overage on the NET price, so the lender's fee comes
 *     out of the rep and not the company
 *   • a fixed-pay lender pays the flat rate instead, whatever the deal prices at
 *   • the terms LOCK once a line exists — raising a rep's redline must not
 *     re-price a deal already sold
 *   • overrides finally compute off the solar contract price
 *   • the roofing path is untouched
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });
const db = raw.$extends(verticalExtension());

let companyId: string;
let repId: string;
let managerId: string;
let redlineLenderId: string;
let fixedPayLenderId: string;

/** $2.00/W net redline, $0.40/W fixed. A 10 kW system throughout. */
const REDLINE_CENTS = 200;
const PER_WATT_MILLS = 400;
const KW = 10;

async function resetFixtures() {
  await raw.$executeRawUnsafe('TRUNCATE TABLE "companies" CASCADE');
  const company = await raw.company.create({
    data: { name: "Solar Pay Co", slug: `sp-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  const rep = await raw.user.create({
    data: {
      companyId, email: `rep-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Solar", lastName: "Rep", role: "sales_rep", verticals: ["roofing", "solar"],
      solarRedlineCentsPerWatt: REDLINE_CENTS, solarPerWattMills: PER_WATT_MILLS,
      // Roofing terms too: a rep who works both sides must not have one side's
      // model reach the other's deal.
      commissionSplitPct: 50,
    },
  });
  repId = rep.id;
  const manager = await raw.user.create({
    data: {
      companyId, email: `mgr-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Solar", lastName: "Manager", role: "manager", verticals: ["solar"],
    },
  });
  managerId = manager.id;

  const [redlineLender, fixedLender] = await Promise.all([
    raw.solarLender.create({ data: { companyId, name: "Redline Bank", repPayMode: "redline" } }),
    raw.solarLender.create({ data: { companyId, name: "Amos Capital Funding", repPayMode: "per_watt" } }),
  ]);
  redlineLenderId = redlineLender.id;
  fixedPayLenderId = fixedLender.id;
}

/**
 * A priced solar deal. `grossPpwCents` is the sticker; `dealerFeePct` is the
 * lender's cut of it.
 */
async function makeSolarDeal(opts: {
  tag: string;
  grossPpwCents: number;
  dealerFeePct: number;
  lenderId: string | null;
  product?: "cash" | "loan" | "lease" | "ppa";
  adderTotalCents?: number;
}): Promise<string> {
  const product = opts.product ?? "loan";
  const lead = await raw.lead.create({
    data: { companyId, vertical: "solar", firstName: opts.tag, lastName: "Deal", assignedRepId: repId },
  });
  await raw.solarDesign.create({
    data: { companyId, leadId: lead.id, systemSizeKwDc: KW, lenderId: opts.lenderId },
  });
  const gross = Math.round(KW * 1000 * opts.grossPpwCents);
  await raw.solarFinance.create({
    data: {
      companyId, leadId: lead.id, product,
      grossPpwCents: opts.grossPpwCents,
      dealerFeePct: opts.dealerFeePct,
      adderTotalCents: opts.adderTotalCents ?? 0,
      contractPriceCents: gross + (opts.adderTotalCents ?? 0),
    },
  });
  const project = await raw.project.create({
    data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `${opts.tag}-1`, contractValue: 0 },
  });
  return project.id;
}

/** The engine runs unscoped, the way a payroll cron does: no workspace context. */
function computeFor(projectId: string) {
  return runUnscoped("test: payroll runs company-wide", () =>
    computeCommissionsForProject(db, companyId, projectId)
  );
}

const repLine = (projectId: string) =>
  raw.commission.findFirst({
    where: { projectId, userId: repId, overrideId: null },
    select: { amount: true, label: true, baseAmount: true, solarBasis: true, solarRedlineCentsPerWatt: true, solarMillsPerWatt: true, vertical: true },
  });

beforeAll(resetFixtures);
beforeEach(resetFixtures);
afterAll(async () => {
  await raw.$disconnect();
});

describe("redline pay", () => {
  it("pays the overage above the redline, net of the lender's fee", async () => {
    // $3.20/W through an 18% lender nets $2.624/W. $0.624 over $2.00 × 10,000 W.
    const p = await makeSolarDeal({ tag: "R1", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    expect(await computeFor(p)).toBe(1);

    const line = await repLine(p);
    expect(line?.amount).toBe(624_000);
    expect(line?.solarBasis).toBe("redline");
    expect(line?.label).toContain("Solar redline");
    // Tagged with the DEAL's vertical, derived from the project — the payroll
    // run has no workspace open.
    expect(line?.vertical).toBe("solar");
  });

  it("expensive money comes out of the rep, not the company", async () => {
    const cheap = await makeSolarDeal({ tag: "C", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    const dear = await makeSolarDeal({ tag: "D", grossPpwCents: 320, dealerFeePct: 32, lenderId: redlineLenderId });
    await computeFor(cheap);
    await computeFor(dear);

    expect((await repLine(cheap))!.amount).toBe(624_000);
    expect((await repLine(dear))!.amount).toBe(176_000);
  });

  it("a cash deal has no lender and no fee, so the whole gross clears the redline", async () => {
    const p = await makeSolarDeal({ tag: "CASH", grossPpwCents: 290, dealerFeePct: 0, lenderId: null, product: "cash" });
    await computeFor(p);
    expect((await repLine(p))!.amount).toBe(900_000); // $0.90/W over
  });

  it("pays nothing when the deal lands under the redline", async () => {
    const p = await makeSolarDeal({ tag: "UNDER", grossPpwCents: 250, dealerFeePct: 32, lenderId: redlineLenderId });
    await computeFor(p);
    expect((await repLine(p))!.amount).toBe(0);
  });

  it("ignores adders — they are priced to cover their own cost, not as rep overage", async () => {
    const plain = await makeSolarDeal({ tag: "P", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    const laden = await makeSolarDeal({ tag: "L", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId, adderTotalCents: 1_450_000 });
    await computeFor(plain);
    await computeFor(laden);
    expect((await repLine(laden))!.amount).toBe((await repLine(plain))!.amount);
  });
});

describe("fixed $/W pay", () => {
  it("a fixed-pay lender pays the flat rate whatever the sticker", async () => {
    const p = await makeSolarDeal({ tag: "A1", grossPpwCents: 320, dealerFeePct: 18, lenderId: fixedPayLenderId });
    await computeFor(p);
    const line = await repLine(p);
    expect(line?.amount).toBe(400_000); // $0.40/W × 10,000 W
    expect(line?.solarBasis).toBe("per_watt");
    expect(line?.label).toContain("Solar per-watt");
  });

  it("the same rate applies however cheap or dear the deal is", async () => {
    const low = await makeSolarDeal({ tag: "AL", grossPpwCents: 210, dealerFeePct: 18, lenderId: fixedPayLenderId });
    const high = await makeSolarDeal({ tag: "AH", grossPpwCents: 480, dealerFeePct: 18, lenderId: fixedPayLenderId });
    await computeFor(low);
    await computeFor(high);
    expect((await repLine(low))!.amount).toBe(400_000);
    expect((await repLine(high))!.amount).toBe(400_000);
  });

  // A lease sells electricity, not a system. There is no price for a redline to
  // measure against, so the array's watts are the only honest basis.
  it("a lease pays per watt even through a redline lender", async () => {
    const p = await makeSolarDeal({ tag: "TPO", grossPpwCents: 0, dealerFeePct: 0, lenderId: redlineLenderId, product: "lease" });
    await computeFor(p);
    const line = await repLine(p);
    expect(line?.amount).toBe(400_000);
    expect(line?.solarBasis).toBe("per_watt");
  });
});

describe("terms lock once the line exists", () => {
  it("raising the rep's redline does not re-price a deal already sold", async () => {
    const p = await makeSolarDeal({ tag: "LOCK", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    await computeFor(p);
    expect((await repLine(p))!.amount).toBe(624_000);

    await raw.user.update({ where: { id: repId }, data: { solarRedlineCentsPerWatt: 260 } });
    await computeFor(p);

    const line = await repLine(p);
    expect(line!.solarRedlineCentsPerWatt).toBe(REDLINE_CENTS);
    expect(line!.amount).toBe(624_000);
  });

  // The opposite half of the same rule: the SNAPSHOT is frozen, the price is not.
  it("but a price change still moves the amount, on the snapshotted terms", async () => {
    const p = await makeSolarDeal({ tag: "REPRICE", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    await computeFor(p);

    const lead = await raw.project.findUniqueOrThrow({ where: { id: p }, select: { leadId: true } });
    await raw.solarFinance.update({ where: { leadId: lead.leadId! }, data: { grossPpwCents: 340 } });
    await computeFor(p);

    // $3.40/W at 18% nets $2.788/W → $0.788 over the ORIGINAL $2.00 redline.
    expect((await repLine(p))!.amount).toBe(788_000);
    expect((await repLine(p))!.solarRedlineCentsPerWatt).toBe(REDLINE_CENTS);
  });

  it("does not duplicate the line on a second run", async () => {
    const p = await makeSolarDeal({ tag: "IDEM", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    expect(await computeFor(p)).toBe(1);
    expect(await computeFor(p)).toBe(0);
    expect(await raw.commission.count({ where: { projectId: p, userId: repId, overrideId: null } })).toBe(1);
  });
});

describe("nothing is invented", () => {
  it("a rep with no solar terms generates no line at all", async () => {
    await raw.user.update({
      where: { id: repId },
      data: { solarRedlineCentsPerWatt: null, solarPerWattMills: null },
    });
    const p = await makeSolarDeal({ tag: "UNSET", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    expect(await computeFor(p)).toBe(0);
    expect(await repLine(p)).toBeNull();
  });

  it("an undesigned deal pays nothing — there are no watts yet", async () => {
    const lead = await raw.lead.create({
      data: { companyId, vertical: "solar", firstName: "Empty", lastName: "Deal", assignedRepId: repId },
    });
    const project = await raw.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: "E-1", contractValue: 0 },
    });
    expect(await computeFor(project.id)).toBe(0);
  });

  // Roofing pays every active sales manager a share of the pool. Solar has no
  // pool, so a manager earns only what an override says.
  it("no manager pool split appears on a solar deal", async () => {
    await raw.user.update({ where: { id: managerId }, data: { commissionSplitPct: 30 } });
    const p = await makeSolarDeal({ tag: "MGR", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    await computeFor(p);
    expect(await raw.commission.count({ where: { projectId: p, userId: managerId } })).toBe(0);
  });
});

describe("overrides finally compute off a real number", () => {
  it("a solar override pays a percentage of the CONTRACT price, not the Project's zero", async () => {
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "solar", type: "percentage", percent: 3 },
    });
    const p = await makeSolarDeal({ tag: "OV", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    await computeFor(p);

    const line = await raw.commission.findFirstOrThrow({
      where: { projectId: p, overrideId: { not: null } },
      select: { userId: true, amount: true, baseAmount: true },
    });
    expect(line.userId).toBe(managerId);
    expect(line.baseAmount).toBe(3_200_000); // 10 kW × $3.20/W
    expect(line.amount).toBe(96_000); // 3%
  });

  it("a roofing override is invisible on a solar deal", async () => {
    await raw.commissionOverride.create({
      data: { companyId, beneficiaryId: managerId, sourceId: repId, vertical: "roofing", type: "percentage", percent: 3 },
    });
    const p = await makeSolarDeal({ tag: "XV", grossPpwCents: 320, dealerFeePct: 18, lenderId: redlineLenderId });
    await computeFor(p);
    expect(await raw.commission.count({ where: { projectId: p, overrideId: { not: null } } })).toBe(0);
  });
});

describe("the roofing path is untouched", () => {
  it("a roofing deal still pays the rep their pool split, and no solar snapshot", async () => {
    const lead = await raw.lead.create({
      data: { companyId, vertical: "roofing", firstName: "Roof", lastName: "Deal", assignedRepId: repId },
    });
    const project = await raw.project.create({
      data: {
        companyId, vertical: "roofing", leadId: lead.id, projectNumber: "RF-1",
        contractValue: 1_000_000, supplementCents: 0, deductibleCents: 0,
      },
    });
    await computeFor(project.id);

    const line = await raw.commission.findFirstOrThrow({
      where: { projectId: project.id, userId: repId, overrideId: null },
      select: { amount: true, label: true, splitPct: true, solarBasis: true },
    });
    expect(line.amount).toBe(500_000); // 50% of a $10,000 pool with no costs
    expect(line.label).toContain("Deal split");
    expect(line.splitPct).toBe(50);
    expect(line.solarBasis).toBeNull();
  });
});
