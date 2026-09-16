import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { ensureChartOfAccounts, systemAccountId } from "../chart";
import { accountBalances } from "../reports";
import { postJournalEntry } from "../posting";
import { createBill } from "../bills";

/**
 * WHICH DEPARTMENT A LEDGER LINE BELONGS TO.
 *
 * `reports.ts` filters the LINE by `vertical` — that is precisely what makes a
 * departmental P&L possible — and the schema classifies JournalLine as TAGGED
 * with `projectId` provenance, promising that "every line is tagged so the P&L
 * breaks out by department".
 *
 * That promise was not being kept on the posting path, and the reason is worth
 * recording because it is invisible from either end:
 *
 *   - `postJournalEntry` creates lines NESTED, as `lines: { create: [...] }`
 *     under `journalEntry.create`.
 *   - The vertical extension therefore sees the operation as a JournalEntry
 *     write. JournalEntry is deliberately NOT tagged (one entry may span
 *     departments), so `classify()` returns "shared" and the extension returns
 *     immediately — never inspecting the nested line rows.
 *   - So JournalLine's provenance never fired. A line's department was only
 *     ever whatever the caller happened to pass.
 *
 * The consequence was silent and one-directional: a vendor bill entered against
 * a SOLAR job was written with a null department, vanished from the solar P&L,
 * and still appeared in the company-wide totals — so every report balanced and
 * nothing looked wrong. That is the failure mode these tests exist to prevent.
 *
 * The fix belongs in the posting door rather than in each caller: it already
 * reads these jobs to validate them, and it is the only way into the ledger.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let ownerId: string;
let solarJobId: string;
let roofJobId: string;
let bankId: string;
let materialsId: string;
let vendorId: string;

const actor = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });

const MAR = new Date("2026-03-10T12:00:00Z");
const YEAR = { startMs: Date.UTC(2026, 0, 1), endMs: Date.UTC(2026, 11, 31, 23, 59, 59, 999) };

const rand = () => Math.random().toString(36).slice(2, 8);

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Dept Co", slug: `dept-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;
  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `o-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  await ensureChartOfAccounts(companyId);

  const solarLead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Dana", lastName: "Homeowner" },
  });
  const roofLead = await db.lead.create({
    data: { companyId, vertical: "roofing", firstName: "Rita", lastName: "Roofer" },
  });
  solarJobId = (
    await db.project.create({
      data: { companyId, leadId: solarLead.id, projectNumber: `S-${rand()}`, vertical: "solar" },
    })
  ).id;
  roofJobId = (
    await db.project.create({
      data: { companyId, leadId: roofLead.id, projectNumber: `R-${rand()}`, vertical: "roofing" },
    })
  ).id;

  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1010" } })).id;
  materialsId = (await systemAccountId(companyId, "materials"))!;
  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const linesOf = (entryId: string) =>
  db.journalLine.findMany({ where: { entryId }, orderBy: { position: "asc" } });

describe("a line's department comes from its job", () => {
  it("tags a line from the job it names, with no vertical passed", async () => {
    const res = await postJournalEntry({
      companyId,
      date: MAR,
      memo: "Panels",
      sourceType: "manual",
      sourceId: `t-${rand()}`,
      actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 50_000, projectId: solarJobId },
        { accountId: bankId, creditCents: 50_000, projectId: solarJobId },
      ],
    });
    if (!res.ok) throw new Error(res.error);

    for (const line of await linesOf(res.entryId)) expect(line.vertical).toBe("solar");
  });

  /** One entry may legitimately span departments — which is exactly why the
   * tag lives on the line and not on the entry. */
  it("tags each line from its OWN job within one entry", async () => {
    const res = await postJournalEntry({
      companyId,
      date: MAR,
      memo: "Split across two jobs",
      sourceType: "manual",
      sourceId: `t-${rand()}`,
      actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 30_000, projectId: solarJobId },
        { accountId: materialsId, debitCents: 20_000, projectId: roofJobId },
        { accountId: bankId, creditCents: 50_000 },
      ],
    });
    if (!res.ok) throw new Error(res.error);

    const lines = await linesOf(res.entryId);
    expect(lines[0]?.vertical).toBe("solar");
    expect(lines[1]?.vertical).toBe("roofing");
    // Money leaving the bank belongs to no single department.
    expect(lines[2]?.vertical).toBeNull();
  });

  /** Office rent, a bank fee, a transfer between our own accounts. */
  it("leaves a line with no job company-level", async () => {
    const res = await postJournalEntry({
      companyId,
      date: MAR,
      memo: "Bank fee",
      sourceType: "manual",
      sourceId: `t-${rand()}`,
      actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 1_500 },
        { accountId: bankId, creditCents: 1_500 },
      ],
    });
    if (!res.ok) throw new Error(res.error);

    for (const line of await linesOf(res.entryId)) expect(line.vertical).toBeNull();
  });

  /** Seeds, backfills and imports state the department themselves. */
  it("lets an explicit vertical win over the job's", async () => {
    const res = await postJournalEntry({
      companyId,
      date: MAR,
      memo: "Stated explicitly",
      sourceType: "manual",
      sourceId: `t-${rand()}`,
      actor: actor(),
      lines: [
        { accountId: materialsId, debitCents: 10_000, projectId: solarJobId, vertical: "roofing" },
        { accountId: bankId, creditCents: 10_000 },
      ],
    });
    if (!res.ok) throw new Error(res.error);

    const lines = await linesOf(res.entryId);
    expect(lines[0]?.vertical).toBe("roofing");
  });
});

describe("the departmental P&L sees what it should", () => {
  /**
   * The bug, stated as the owner would notice it — or rather, would NOT
   * notice it: the cost was in the company totals the whole time.
   */
  it("shows a solar job's bill in the solar P&L", async () => {
    const res = await createBill({
      companyId,
      vendorId,
      billNumber: `B-${rand()}`,
      amountCents: 125_000,
      billedAt: MAR,
      expenseAccountId: materialsId,
      projectId: solarJobId,
      actor: actor(),
    });
    if (!res.ok) throw new Error(res.error);

    const solar = await accountBalances({ companyId, period: YEAR, vertical: "solar" });
    expect(solar.find((r) => r.accountId === materialsId)?.balanceCents ?? 0).toBe(125_000);

    // And it is not double-counted into the other department.
    const roofing = await accountBalances({ companyId, period: YEAR, vertical: "roofing" });
    expect(roofing.find((r) => r.accountId === materialsId)?.balanceCents ?? 0).toBe(0);
  });

  it("tags the bill row itself, so bill-level reporting breaks out too", async () => {
    const res = await createBill({
      companyId,
      vendorId,
      billNumber: `B-${rand()}`,
      amountCents: 60_000,
      billedAt: MAR,
      expenseAccountId: materialsId,
      projectId: solarJobId,
      actor: actor(),
    });
    if (!res.ok) throw new Error(res.error);

    const bill = await db.bill.findFirstOrThrow({ where: { id: res.billId } });
    expect(bill.vertical).toBe("solar");
  });

  /** A bill for no particular job — office rent — stays company-level and is
   * still counted in the combined totals. */
  it("keeps a job-less bill out of both departments but in the company total", async () => {
    const res = await createBill({
      companyId,
      vendorId,
      billNumber: `B-${rand()}`,
      amountCents: 40_000,
      billedAt: MAR,
      expenseAccountId: materialsId,
      actor: actor(),
    });
    if (!res.ok) throw new Error(res.error);

    const solar = await accountBalances({ companyId, period: YEAR, vertical: "solar" });
    expect(solar.find((r) => r.accountId === materialsId)?.balanceCents ?? 0).toBe(0);

    const combined = await accountBalances({ companyId, period: YEAR });
    expect(combined.find((r) => r.accountId === materialsId)?.balanceCents ?? 0).toBe(40_000);
  });
});
