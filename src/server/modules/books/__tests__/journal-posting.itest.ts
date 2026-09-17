import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import { postJournalEntry, voidJournalEntry, setPeriodLock, getPeriodLock } from "../posting";
import { ensureChartOfAccounts, systemAccountId } from "../chart";

/**
 * THE POSTING SERVICE IS THE ONLY DOOR INTO THE LEDGER, so this is where the
 * properties that make a set of books trustworthy are pinned:
 *
 *   • debits equal credits or NOTHING is written — not a warning, not a
 *     lopsided entry somebody fixes later;
 *   • a closed period rejects an entry unless an owner says why, in writing;
 *   • a keyed source cannot post twice, even when two requests race;
 *   • an entry is never deleted — voiding REVERSES it and keeps both;
 *   • every write leaves an audit row naming who did it.
 *
 * Against a real database, because every one of these is a database property.
 * The rule this file exists to prevent is the one the single-entry ledger it
 * replaces could not express at all: there was no "balanced", so there was
 * nothing to check.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let projectId: string;
let vendorId: string;
let ownerId: string;
let bookkeeperId: string;
let bankId: string;
let revenueId: string;
let materialsId: string;

const owner = () => ({ kind: "user" as const, userId: ownerId, role: "super_admin" as const });
const bookkeeper = () => ({ kind: "user" as const, userId: bookkeeperId, role: "accounting" as const });
const system = () => ({ kind: "system" as const, label: "test-runner" });

const DAY = new Date("2026-06-15T12:00:00Z");

/**
 * A FRESH COMPANY PER TEST, rather than `TRUNCATE "companies" CASCADE`.
 *
 * Every assertion in this file is already scoped by companyId, so a new company
 * IS the isolation — and it keeps the suite inside the repo's no-raw-SQL rule,
 * which the truncate would otherwise have needed an allowlist entry to break.
 * Deleting the company at the end cascades to everything created under it.
 */
async function resetFixtures() {
  const company = await db.company.create({
    data: { name: "Ledger Co", slug: `ledger-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
  });
  companyId = company.id;

  ownerId = (
    await db.user.create({
      data: {
        companyId, email: `owner-${process.pid}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing", "solar"],
      },
    })
  ).id;
  bookkeeperId = (
    await db.user.create({
      data: {
        companyId, email: `book-${process.pid}@t.local`, passwordHash: "x",
        firstName: "Bo", lastName: "Keeper", role: "accounting", verticals: ["roofing", "solar"],
      },
    })
  ).id;

  const lead = await db.lead.create({
    data: { companyId, vertical: "solar", firstName: "Sun", lastName: "House", address: "9 Ray Rd" },
  });
  projectId = (
    await db.project.create({
      data: { companyId, vertical: "solar", leadId: lead.id, projectNumber: `S-${process.pid}-${Date.now()}` },
    })
  ).id;
  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Acme Supply" } })).id;

  await ensureChartOfAccounts(companyId);
  bankId = (await db.ledgerAccount.findFirstOrThrow({ where: { companyId, number: "1020" } })).id;
  revenueId = (await systemAccountId(companyId, "solar_revenue"))!;
  materialsId = (await systemAccountId(companyId, "materials"))!;
}

/**
 * NO CASCADE DELETE IN TEARDOWN, deliberately.
 *
 * Each test gets its own company and every assertion is scoped to it, so
 * deleting it buys no isolation. What it did buy was a large cascading delete
 * holding locks while other suites take an AccessExclusiveLock to
 * `TRUNCATE companies CASCADE` — which deadlocked (Postgres 40P01) and failed
 * suites unrelated to this one. The schema is disposable; globalSetup rebuilds it.
 */
beforeEach(resetFixtures);
afterAll(async () => {
  await db.$disconnect();
});

/** A balanced deposit: cash up, revenue up. */
const deposit = (overrides: Partial<Parameters<typeof postJournalEntry>[0]> = {}) => ({
  companyId,
  date: DAY,
  memo: "Customer deposit",
  sourceType: "manual",
  actor: bookkeeper(),
  lines: [
    { accountId: bankId, debitCents: 250_000, vertical: "solar" as const },
    { accountId: revenueId, creditCents: 250_000, vertical: "solar" as const, projectId },
  ],
  ...overrides,
});

describe("the chart of accounts", () => {
  it("seeds once and is idempotent", async () => {
    const before = await db.ledgerAccount.count({ where: { companyId } });
    expect(before).toBeGreaterThan(30);

    const again = await ensureChartOfAccounts(companyId);
    expect(again.created).toBe(0);
    expect(await db.ledgerAccount.count({ where: { companyId } })).toBe(before);
  });

  it("never renames an account a bookkeeper has renamed", async () => {
    await db.ledgerAccount.update({ where: { id: materialsId }, data: { name: "Roofing Materials" } });
    await ensureChartOfAccounts(companyId);
    const after = await db.ledgerAccount.findUniqueOrThrow({ where: { id: materialsId } });
    expect(after.name).toBe("Roofing Materials");
  });

  it("gives the code stable handles that survive renumbering", async () => {
    await db.ledgerAccount.update({ where: { id: revenueId }, data: { number: "4999" } });
    expect(await systemAccountId(companyId, "solar_revenue")).toBe(revenueId);
  });
});

describe("an entry balances or nothing is written", () => {
  it("posts a balanced entry with both sides intact", async () => {
    const res = await postJournalEntry(deposit());
    expect(res).toMatchObject({ ok: true, duplicate: false });

    const entry = await db.journalEntry.findFirstOrThrow({
      where: { companyId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    expect(entry.status).toBe("posted");
    expect(entry.lines).toHaveLength(2);
    expect(entry.lines[0].debitCents).toBe(250_000);
    expect(entry.lines[0].creditCents).toBe(0);
    expect(entry.lines[1].creditCents).toBe(250_000);
    const debits = entry.lines.reduce((s, l) => s + l.debitCents, 0);
    const credits = entry.lines.reduce((s, l) => s + l.creditCents, 0);
    expect(debits).toBe(credits);
  });

  it("REFUSES an unbalanced entry and writes nothing at all", async () => {
    const res = await postJournalEntry(
      deposit({
        lines: [
          { accountId: bankId, debitCents: 250_000 },
          { accountId: revenueId, creditCents: 249_999 },
        ],
      })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) {
      // The message names both sides and the difference. "Out of balance" alone
      // sends a bookkeeper hunting for a number nobody told them.
      expect(res.error).toContain("250000");
      expect(res.error).toContain("249999");
      expect(res.error).toContain("1");
    }
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
    expect(await db.journalLine.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a line that is both a debit and a credit", async () => {
    const res = await postJournalEntry(
      deposit({
        lines: [
          { accountId: bankId, debitCents: 100, creditCents: 100 },
          { accountId: revenueId, creditCents: 100 },
        ],
      })
    );
    expect(res.ok).toBe(false);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("refuses fractional, negative and empty amounts", async () => {
    for (const bad of [{ debitCents: 10.5 }, { debitCents: -100 }, { debitCents: 0 }]) {
      const res = await postJournalEntry(
        deposit({ lines: [{ accountId: bankId, ...bad }, { accountId: revenueId, creditCents: 100 }] })
      );
      expect(res.ok).toBe(false);
    }
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a one-legged entry", async () => {
    const res = await postJournalEntry(deposit({ lines: [{ accountId: bankId, debitCents: 100 }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/two lines/i);
  });

  it("refuses an account belonging to another company", async () => {
    const other = await db.company.create({
      data: { name: "Other", slug: `other-${process.pid}-${Date.now()}` },
    });
    await ensureChartOfAccounts(other.id);
    const theirs = await db.ledgerAccount.findFirstOrThrow({
      where: { companyId: other.id, number: "1020" },
    });

    const res = await postJournalEntry(
      deposit({ lines: [{ accountId: theirs.id, debitCents: 100 }, { accountId: revenueId, creditCents: 100 }] })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/no such account/i);
  });

  it("refuses an inactive account, because deactivating one must mean something", async () => {
    await db.ledgerAccount.update({ where: { id: materialsId }, data: { active: false } });
    const res = await postJournalEntry(
      deposit({ lines: [{ accountId: materialsId, debitCents: 100 }, { accountId: bankId, creditCents: 100 }] })
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/inactive/i);
  });
});

describe("a keyed source cannot post twice", () => {
  it("returns the original entry rather than double-booking", async () => {
    const input = deposit({ sourceType: "payroll", sourceId: "payroll:run1:item:abc" });
    const first = await postJournalEntry(input);
    const second = await postJournalEntry(input);

    expect(first).toMatchObject({ ok: true, duplicate: false });
    expect(second).toMatchObject({ ok: true, duplicate: true });
    if (first.ok && second.ok) expect(second.entryId).toBe(first.entryId);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
  });

  it("holds under a race, because the DATABASE is the guard", async () => {
    const input = deposit({ sourceType: "payroll", sourceId: "payroll:run2:item:xyz" });
    const results = await Promise.all([
      postJournalEntry(input),
      postJournalEntry(input),
      postJournalEntry(input),
    ]);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
  });

  it("lets any number of hand-written entries coexist, since they key to NULL", async () => {
    await postJournalEntry(deposit({ memo: "one" }));
    await postJournalEntry(deposit({ memo: "two" }));
    await postJournalEntry(deposit({ memo: "three" }));
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(3);
  });
});

describe("a closed period", () => {
  beforeEach(async () => {
    await setPeriodLock({
      companyId,
      lockedThrough: new Date("2026-06-30T23:59:59Z"),
      note: "June closed",
      actor: owner(),
    });
  });

  it("is owner-only to set", async () => {
    const res = await setPeriodLock({
      companyId,
      lockedThrough: new Date("2026-07-31T23:59:59Z"),
      actor: bookkeeper(),
    });
    expect(res.ok).toBe(false);
    expect((await getPeriodLock(companyId))!.toISOString()).toContain("2026-06-30");
  });

  it("refuses a bookkeeper posting inside it", async () => {
    const res = await postJournalEntry(deposit());
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/closed/i);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a SYSTEM actor too — automation never overrides a close", async () => {
    const res = await postJournalEntry(deposit({ actor: system() }));
    expect(res.ok).toBe(false);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("refuses even an owner who gives no reason", async () => {
    const res = await postJournalEntry(deposit({ actor: owner() }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/reason/i);
  });

  it("lets an owner in WITH a reason, and records it on the entry", async () => {
    const res = await postJournalEntry(
      deposit({ actor: owner(), lockOverrideReason: "Late vendor bill for June" })
    );
    expect(res.ok).toBe(true);
    const entry = await db.journalEntry.findFirstOrThrow({ where: { companyId } });
    expect(entry.lockOverrideReason).toBe("Late vendor bill for June");

    const audit = await db.financeAuditEvent.findFirstOrThrow({
      where: { companyId, action: "journal.post" },
    });
    expect(audit.reason).toBe("Late vendor bill for June");
  });

  it("does not touch entries dated after the close", async () => {
    const res = await postJournalEntry(deposit({ date: new Date("2026-07-01T12:00:00Z") }));
    expect(res.ok).toBe(true);
  });

  it("reopens when the lock is lifted", async () => {
    await setPeriodLock({ companyId, lockedThrough: null, actor: owner() });
    expect(await getPeriodLock(companyId)).toBeNull();
    expect((await postJournalEntry(deposit())).ok).toBe(true);
  });
});

describe("voiding reverses, never deletes", () => {
  it("writes a mirror entry and leaves both in the books", async () => {
    const posted = await postJournalEntry(deposit());
    expect(posted.ok).toBe(true);
    if (!posted.ok) return;

    const res = await voidJournalEntry({
      companyId,
      entryId: posted.entryId,
      reason: "Deposited to the wrong account",
      actor: bookkeeper(),
    });
    expect(res.ok).toBe(true);

    // BOTH entries survive. Nothing is deleted, ever.
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(2);

    const original = await db.journalEntry.findUniqueOrThrow({
      where: { id: posted.entryId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    expect(original.status).toBe("void");
    expect(original.voidReason).toBe("Deposited to the wrong account");
    expect(original.voidedAt).not.toBeNull();

    const reversal = await db.journalEntry.findFirstOrThrow({
      where: { companyId, reversesId: posted.entryId },
      include: { lines: { orderBy: { position: "asc" } } },
    });
    // Every debit is now a credit and vice versa — that is the whole of what a
    // reversal is.
    expect(reversal.lines[0].creditCents).toBe(original.lines[0].debitCents);
    expect(reversal.lines[0].debitCents).toBe(original.lines[0].creditCents);
    expect(reversal.lines[1].debitCents).toBe(original.lines[1].creditCents);

    // …and the pair nets to zero across every account.
    const all = await db.journalLine.findMany({ where: { companyId } });
    const net = all.reduce((s, l) => s + l.debitCents - l.creditCents, 0);
    expect(net).toBe(0);
  });

  it("keeps the reversal on the original's date, so a closed month cannot move", async () => {
    const posted = await postJournalEntry(deposit());
    if (!posted.ok) throw new Error("setup");
    await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "wrong", actor: bookkeeper() });
    const reversal = await db.journalEntry.findFirstOrThrow({ where: { reversesId: posted.entryId } });
    expect(reversal.date.toISOString()).toBe(DAY.toISOString());
  });

  it("refuses a second void", async () => {
    const posted = await postJournalEntry(deposit());
    if (!posted.ok) throw new Error("setup");
    await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "once", actor: bookkeeper() });
    const again = await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "twice", actor: bookkeeper() });
    expect(again.ok).toBe(false);
    if (!again.ok) expect(again.error).toMatch(/already void/i);
  });

  it("demands a reason", async () => {
    const posted = await postJournalEntry(deposit());
    if (!posted.ok) throw new Error("setup");
    const res = await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "   ", actor: bookkeeper() });
    expect(res.ok).toBe(false);
  });

  it("obeys the period lock, because a void IS a posting", async () => {
    const posted = await postJournalEntry(deposit());
    if (!posted.ok) throw new Error("setup");
    await setPeriodLock({
      companyId,
      lockedThrough: new Date("2026-06-30T23:59:59Z"),
      actor: owner(),
    });
    const res = await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "late", actor: bookkeeper() });
    expect(res.ok).toBe(false);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(1);
  });
});

describe("every financial write is audited", () => {
  it("names who posted, and keeps the after image", async () => {
    const res = await postJournalEntry(deposit());
    if (!res.ok) throw new Error("setup");
    const audit = await db.financeAuditEvent.findFirstOrThrow({
      where: { companyId, action: "journal.post" },
    });
    expect(audit.actorId).toBe(bookkeeperId);
    expect(audit.entityType).toBe("JournalEntry");
    expect(audit.entityId).toBe(res.entryId);
    expect(audit.after).not.toBeNull();
  });

  it("says SYSTEM when no person acted, rather than leaving it blank", async () => {
    await postJournalEntry(deposit({ actor: system() }));
    const audit = await db.financeAuditEvent.findFirstOrThrow({ where: { companyId, action: "journal.post" } });
    expect(audit.actorId).toBeNull();
    expect(audit.actorLabel).toBe("system:test-runner");
  });

  it("records a void with before and after", async () => {
    const posted = await postJournalEntry(deposit());
    if (!posted.ok) throw new Error("setup");
    await voidJournalEntry({ companyId, entryId: posted.entryId, reason: "duplicate deposit", actor: owner() });
    const audit = await db.financeAuditEvent.findFirstOrThrow({ where: { companyId, action: "journal.void" } });
    expect(audit.reason).toBe("duplicate deposit");
    expect(audit.before).toMatchObject({ status: "posted" });
  });

  it("records closing and reopening a period", async () => {
    await setPeriodLock({ companyId, lockedThrough: new Date("2026-06-30T23:59:59Z"), actor: owner() });
    await setPeriodLock({ companyId, lockedThrough: null, actor: owner() });
    const actions = (
      await db.financeAuditEvent.findMany({ where: { companyId }, orderBy: { createdAt: "asc" } })
    ).map((a) => a.action);
    expect(actions).toContain("period.lock");
    expect(actions).toContain("period.unlock");
  });
});

describe("a line may only tag THIS company's job and vendor", () => {
  /**
   * The id on a line comes from the caller. Before this check it was written
   * straight through, so a bookkeeper at one company could cost a line to
   * another company's job — and the entry would balance, post, and look
   * entirely ordinary while the cost landed on a deal its owner cannot see.
   */
  async function foreignCompany() {
    const other = await db.company.create({
      data: { name: "Other Co", slug: `other-${process.pid}-${Date.now()}`, overheadPct: 0, paFeePct: 0 },
    });
    const pipeline = await db.pipeline.create({
      data: { companyId: other.id, name: "Solar", vertical: "solar" },
    });
    const stage = await db.pipelineStage.create({
      data: { pipelineId: pipeline.id, key: "m1", name: "M1", position: 10 },
    });
    const lead = await db.lead.create({
      data: {
        companyId: other.id, vertical: "solar", pipelineId: pipeline.id,
        stageId: stage.id, firstName: "Not", lastName: "Ours",
      },
    });
    const project = await db.project.create({
      data: { companyId: other.id, vertical: "solar", leadId: lead.id, projectNumber: `OTH-${Date.now()}` },
    });
    const vendor = await db.bookkeepingVendor.create({
      data: { companyId: other.id, name: "Their Supplier" },
    });
    return { projectId: project.id, vendorId: vendor.id };
  }

  it("refuses a job belonging to another company, and writes nothing", async () => {
    const foreign = await foreignCompany();

    const res = await postJournalEntry({
      companyId, date: DAY, memo: "Costed to someone else's job",
      sourceType: "manual", sourceId: null, actor: owner(),
      lines: [
        { accountId: materialsId, debitCents: 50_000, projectId: foreign.projectId },
        { accountId: bankId, creditCents: 50_000 },
      ],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) {
      expect(res.error).toMatch(/not on this company's books/i);
      // The id is not echoed — the error must not confirm that a row exists
      // somewhere else.
      expect(res.error).not.toContain(foreign.projectId);
    }
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
    expect(await db.journalLine.count({ where: { companyId } })).toBe(0);
  });

  it("refuses a vendor belonging to another company", async () => {
    const foreign = await foreignCompany();

    const res = await postJournalEntry({
      companyId, date: DAY, memo: "Paid someone else's supplier",
      sourceType: "manual", sourceId: null, actor: owner(),
      lines: [
        { accountId: materialsId, debitCents: 25_000, vendorId: foreign.vendorId },
        { accountId: bankId, creditCents: 25_000 },
      ],
    });

    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toMatch(/vendor is not on this company's books/i);
    expect(await db.journalEntry.count({ where: { companyId } })).toBe(0);
  });

  it("still posts a job and vendor that DO belong to this company", async () => {
    const res = await postJournalEntry({
      companyId, date: DAY, memo: "Our own job",
      sourceType: "manual", sourceId: null, actor: owner(),
      lines: [
        { accountId: materialsId, debitCents: 30_000, projectId, vendorId },
        { accountId: bankId, creditCents: 30_000 },
      ],
    });

    // The guard must not have made the ordinary case impossible.
    expect(res.ok).toBe(true);
    const line = await db.journalLine.findFirst({
      where: { companyId, accountId: materialsId },
      select: { projectId: true, vendorId: true },
    });
    expect(line).toMatchObject({ projectId, vendorId });
  });

  it("allows a job from a DIFFERENT vertical than the one posting", async () => {
    /**
     * The check is company tenancy, not workspace. One cheque may pay a roofing
     * sub and a solar sub, which is why the department tag sits on the line —
     * so a vertical filter here would reject a valid entry depending on which
     * workspace the poster happened to have open.
     */
    const roofingLead = await db.lead.create({
      data: {
        companyId, vertical: "roofing",
        firstName: "Roof", lastName: "Job",
      },
    });
    const roofingProject = await db.project.create({
      data: { companyId, vertical: "roofing", leadId: roofingLead.id, projectNumber: `ROOF-${Date.now()}` },
    });

    const res = await postJournalEntry({
      companyId, date: DAY, memo: "Both departments on one cheque",
      sourceType: "manual", sourceId: null, actor: owner(),
      lines: [
        { accountId: materialsId, debitCents: 10_000, projectId: roofingProject.id, vertical: "roofing" },
        { accountId: materialsId, debitCents: 10_000, projectId, vertical: "solar" },
        { accountId: bankId, creditCents: 20_000 },
      ],
    });

    expect(res.ok).toBe(true);
  });
});

describe("the department tag sits on the LINE", () => {
  it("lets one entry carry both verticals", async () => {
    // A single cheque paying a roofing sub and a solar sub. An entry-level tag
    // could not express this at all, which is why the column is on the line.
    const res = await postJournalEntry({
      companyId,
      date: DAY,
      memo: "One cheque, two departments",
      sourceType: "manual",
      actor: bookkeeper(),
      lines: [
        { accountId: materialsId, debitCents: 60_000, vertical: "roofing" },
        { accountId: materialsId, debitCents: 40_000, vertical: "solar", projectId },
        { accountId: bankId, creditCents: 100_000 },
      ],
    });
    expect(res.ok).toBe(true);

    const lines = await db.journalLine.findMany({ where: { companyId }, orderBy: { position: "asc" } });
    expect(lines[0].vertical).toBe("roofing");
    expect(lines[1].vertical).toBe("solar");
    expect(lines[1].projectId).toBe(projectId);
  });

  it("keeps the real foreign keys, so a join cannot dangle", async () => {
    await postJournalEntry(
      deposit({
        lines: [
          { accountId: materialsId, debitCents: 5_000, projectId, vendorId },
          { accountId: bankId, creditCents: 5_000 },
        ],
      })
    );
    const line = await db.journalLine.findFirstOrThrow({
      where: { companyId, vendorId: { not: null } },
      include: { vendor: true, project: true },
    });
    expect(line.vendor!.name).toBe("Acme Supply");
    expect(line.project!.id).toBe(projectId);
  });
});
