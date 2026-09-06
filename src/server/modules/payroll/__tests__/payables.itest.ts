import { describe, it, expect, beforeAll, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { collectPayables } from "@/server/modules/payroll/payables";

/**
 * What a payroll run picks up — and, above all, what it must never leave behind.
 *
 * The rule under test is that money approved too late for one run lands on the
 * NEXT one. Before this the sweep required the line to have been CREATED inside
 * the period, so a commission approved after its own week had closed fell
 * outside every future window and was never payable again by any run. That is
 * the shape of "the rep didn't get paid and nobody could see why".
 */

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let repId: string;
let otherCompanyId: string;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

beforeAll(async () => {
  const c = await db.company.create({
    data: { name: "Payables Co", slug: `pay-${process.pid}-${Date.now()}` },
  });
  companyId = c.id;
  const other = await db.company.create({
    data: { name: "Other Co", slug: `oth-${process.pid}-${Date.now()}` },
  });
  otherCompanyId = other.id;
  const rep = await db.user.create({
    data: {
      companyId, email: `rep-pay-${process.pid}@test.local`, passwordHash: "x",
      firstName: "Payable", lastName: "Rep", role: "sales_rep",
    },
  });
  repId = rep.id;
});

afterAll(async () => {
  // The other company's fixture commission points at OUR rep, so it has to go
  // first or deleting his company trips the foreign key.
  await db.company.delete({ where: { id: otherCompanyId } });
  await db.company.delete({ where: { id: companyId } });
  await db.$disconnect();
});

beforeEach(async () => {
  await db.payrollRun.deleteMany({ where: { companyId } });
  await db.commission.deleteMany({ where: { companyId } });
  await db.contractorPay.deleteMany({ where: { companyId } });
  await db.fileAsset.deleteMany({ where: { companyId } });
  await db.project.deleteMany({ where: { companyId } });
  await db.lead.deleteMany({ where: { companyId } });
});

/** A commission, with its created and approved dates set independently. */
async function commission(opts: {
  amount: number;
  status?: "pending" | "approved" | "paid" | "void";
  createdAt?: Date;
  approvedAt?: Date | null;
  company?: string;
}) {
  const cid = opts.company ?? companyId;
  const lead = await db.lead.create({
    data: { companyId: cid, firstName: "Pay", lastName: "Deal" },
  });
  const project = await db.project.create({
    data: { companyId: cid, leadId: lead.id, projectNumber: `PAY-${Date.now()}-${Math.random()}` },
  });
  return db.commission.create({
    data: {
      companyId: cid,
      projectId: project.id,
      userId: repId,
      label: "Solar redline",
      amount: opts.amount,
      status: opts.status ?? "approved",
      createdAt: opts.createdAt ?? new Date(),
      approvedAt: opts.approvedAt === undefined ? new Date() : opts.approvedAt,
    },
    select: { id: true, amount: true },
  });
}

describe("collectPayables", () => {
  it("picks up an approved, unbatched commission", async () => {
    const c = await commission({ amount: 5_000_00 });
    const { commissions } = await collectPayables(companyId, new Date());
    expect(commissions.map((x) => x.id)).toEqual([c.id]);
  });

  it("leaves PENDING money alone — approval is the gate, not the date", async () => {
    await commission({ amount: 5_000_00, status: "pending", approvedAt: null });
    const { commissions } = await collectPayables(companyId, new Date());
    expect(commissions).toHaveLength(0);
  });

  it("A LATE APPROVAL IS SWEPT INTO THE NEXT RUN, however old the line is", async () => {
    // Created eight weeks ago; the lender only funded — and an admin only
    // approved — yesterday. Every window since its creation has closed.
    const late = await commission({
      amount: 12_000_00,
      createdAt: ago(56),
      approvedAt: ago(1),
    });
    // This period covers only the last seven days. The old sweep, which asked
    // where the row was CREATED, would have returned nothing here.
    const { commissions } = await collectPayables(companyId, new Date());
    expect(commissions.map((x) => x.id)).toContain(late.id);
  });

  it("does not pay money approved AFTER the period closed — it waits for the next run", async () => {
    await commission({ amount: 9_000_00, createdAt: ago(20), approvedAt: ago(2) });
    // A run being cut for a period that ended a week ago.
    const { commissions } = await collectPayables(companyId, ago(7));
    expect(commissions).toHaveLength(0);

    // …and the very next run, whose period has closed since, picks it up.
    const next = await collectPayables(companyId, new Date());
    expect(next.commissions).toHaveLength(1);
  });

  it("falls back to createdAt for rows approved before approvedAt was recorded", async () => {
    const legacy = await commission({ amount: 3_000_00, createdAt: ago(30), approvedAt: null });
    // Explicitly approved with no timestamp — the historical shape.
    await db.commission.update({ where: { id: legacy.id }, data: { status: "approved" } });

    expect((await collectPayables(companyId, ago(45))).commissions).toHaveLength(0);
    expect((await collectPayables(companyId, new Date())).commissions.map((c) => c.id)).toContain(legacy.id);
  });

  it("never re-batches a line already in a run", async () => {
    const c = await commission({ amount: 7_000_00 });
    const run = await db.payrollRun.create({
      data: {
        companyId, label: "Week 1",
        periodStart: ago(7), periodEnd: new Date(),
        items: { create: [{ userId: repId, commissionId: c.id, label: "Solar redline", amount: c.amount }] },
      },
      select: { id: true },
    });

    expect((await collectPayables(companyId, new Date())).commissions).toHaveLength(0);

    // Delete the run and the line returns to the pool — even though its own
    // period is now in the past. This is the second thing the lower bound broke.
    await db.payrollRun.delete({ where: { id: run.id } });
    expect((await collectPayables(companyId, new Date())).commissions.map((x) => x.id)).toEqual([c.id]);
  });

  it("stops at the company boundary", async () => {
    await commission({ amount: 4_000_00, company: otherCompanyId });
    expect((await collectPayables(companyId, new Date())).commissions).toHaveLength(0);
  });

  it("sweeps contractor invoices by the same rule", async () => {
    const lead = await db.lead.create({ data: { companyId, firstName: "Crew", lastName: "Job" } });
    const project = await db.project.create({
      data: { companyId, leadId: lead.id, projectNumber: `CON-${Date.now()}` },
    });
    // The invoice IS the pay record — a ContractorPay cannot exist without one.
    const invoice = await db.fileAsset.create({
      data: {
        companyId, kind: "document", name: "invoice.pdf",
        storageKey: `test/pay-${Date.now()}.pdf`, mimeType: "application/pdf", size: 1,
      },
      select: { id: true },
    });
    const pay = await db.contractorPay.create({
      data: {
        companyId, projectId: project.id, userId: repId, invoiceId: invoice.id,
        amount: 2_500_00, status: "approved", createdAt: ago(40), approvedAt: ago(1),
      },
      select: { id: true },
    });
    const { contractorPays } = await collectPayables(companyId, new Date());
    expect(contractorPays.map((p) => p.id)).toEqual([pay.id]);
  });
});

describe("the Monday-to-Friday workweek", () => {
  it("SWEEPS UP A WEEKEND FUNDING that belongs to no period at all", async () => {
    // A workweek excludes Saturday and Sunday, so money approved on a Saturday
    // is inside NO period. It must not be folded back into the week that closed
    // the day before, and it must not fall down the gap between two weeks.
    //
    // Thu 11 Sep 2025 pays Mon 1 – Fri 5. Thu 18 Sep pays Mon 8 – Fri 12.
    // Saturday 6 September sits between them, in neither.
    const saturday = new Date(2025, 8, 6, 11, 0);
    const c = await commission({ amount: 6_000_00, createdAt: saturday, approvedAt: saturday });

    // The Thursday whose period had already closed does not reach it.
    const closedFriday = new Date(2025, 8, 5, 23, 59, 59, 999);
    expect((await collectPayables(companyId, closedFriday)).commissions).toHaveLength(0);

    // The next applicable cycle does.
    const nextFriday = new Date(2025, 8, 12, 23, 59, 59, 999);
    expect((await collectPayables(companyId, nextFriday)).commissions.map((x) => x.id)).toContain(c.id);
  });
});
