import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import { PrismaClient, type Role } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";

/**
 * A FILE ON A LEDGER TRANSACTION IS BOOKKEEPING DATA, NOT A LOOSE COMPANY FILE.
 *
 * Receipts (bookkeeping/actions.ts) and pay stubs (payroll/post-bookkeeping.ts)
 * are FileAssets with `scope: "company"`, a `transactionId`, and no lead,
 * project or conversation. `/portal/files/[id]` used to decide them by ROLE:
 *
 *   - super_admin and admin skipped the staff branch, so any admin, holding no
 *     Bookkeeping grant at all, could open a receipt or an employee's pay stub
 *     by id;
 *   - everyone else went through the staff branch, which only ever admits a
 *     file on a deal, so accounting (the people who run Bookkeeping) got 403,
 *     even on the receipts they had uploaded themselves.
 *
 * The rule is "bank/finance data is visible only to super admin and
 * accounting", which is exactly `can(user, "read", "Bookkeeping")`. These tests
 * go through the real route with the real matrix. Only the session is mocked.
 * The receipt is written by the real upload action and the pay stub by the real
 * payroll posting, so the rows under test have the same shape production writes.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";
process.env.STORAGE_DRIVER = "db";

const raw = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

type Current = {
  userId: string;
  companyId: string;
  role: Role;
  fullName: string;
  permissions: Record<string, unknown>;
};
let current: Current;

vi.mock("@/server/auth/session", () => ({
  requireUser: async () => current,
  getSessionUser: async () => current,
}));
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));

const { runInVertical } = await import("@/server/vertical/context");
const { can } = await import("@/server/rbac/guards");
const { putObject } = await import("@/server/storage");
const { GET } = await import("../[id]/route");
const { uploadTransactionAttachmentAction, deleteTransactionAttachmentAction } = await import(
  "@/server/modules/bookkeeping/actions"
);
const { deleteFileAction, moveFileAction } = await import("@/server/modules/files/actions");
const { postRunToBookkeeping } = await import("@/server/modules/payroll/post-bookkeeping");

const stamp = `${process.pid}-${Date.now()}`;

let companyId = "";
let otherCompanyId = "";

type Person = Current;
const people: Record<
  "owner" | "admin" | "adminWithBooks" | "accounting" | "manager" | "rep" | "otherAccounting",
  Person
> = {} as never;

let receiptId = "";
let payStubId = "";
let dealFileId = "";

const RECEIPT_BYTES = Buffer.from("%PDF-1.4 receipt for lumber");
const DEAL_FILE_BYTES = Buffer.from("roof photo bytes");

async function makePerson(
  cid: string,
  tag: string,
  role: Role,
  permissions: Record<string, unknown> = {}
): Promise<Person> {
  const u = await raw.user.create({
    data: {
      companyId: cid,
      email: `${tag}-${stamp}@transaction-files.test`,
      firstName: tag,
      lastName: "User",
      role,
      status: "active",
      passwordHash: "x",
      verticals: ["roofing", "solar"],
      permissions: permissions as never,
    },
    select: { id: true },
  });
  return { userId: u.id, companyId: cid, role, fullName: `${tag} User`, permissions };
}

/** GET /portal/files/:id as `who`, inside the Roofing workspace. */
async function open(who: Person, id: string) {
  current = who;
  return runInVertical("roofing", () =>
    GET(new Request(`http://localhost/portal/files/${id}`), { params: Promise.resolve({ id }) })
  );
}

beforeAll(async () => {
  companyId = (await raw.company.create({ data: { name: "Books Co", slug: `books-${stamp}` } })).id;
  otherCompanyId = (await raw.company.create({ data: { name: "Other Books Co", slug: `books-other-${stamp}` } })).id;

  people.owner = await makePerson(companyId, "owner", "super_admin");
  people.admin = await makePerson(companyId, "admin", "admin");
  people.adminWithBooks = await makePerson(companyId, "adminbooks", "admin", { "Bookkeeping:read": true });
  people.accounting = await makePerson(companyId, "accounting", "accounting");
  people.manager = await makePerson(companyId, "manager", "manager");
  people.rep = await makePerson(companyId, "rep", "sales_rep");
  people.otherAccounting = await makePerson(otherCompanyId, "otheraccounting", "accounting");

  // A roofing deal assigned to the rep, with one ordinary file on it.
  const pipeline = await raw.pipeline.create({ data: { companyId, name: "Roofing", vertical: "roofing" } });
  const stage = await raw.pipelineStage.create({
    data: { pipelineId: pipeline.id, key: "new", name: "New", position: 1 },
  });
  const lead = await raw.lead.create({
    data: {
      companyId,
      vertical: "roofing",
      pipelineId: pipeline.id,
      stageId: stage.id,
      firstName: "Deal",
      lastName: "Owner",
      assignedRepId: people.rep.userId,
    },
  });
  const project = await raw.project.create({
    data: { companyId, vertical: "roofing", leadId: lead.id, projectNumber: `TXF-${stamp}` },
  });
  const dealKey = `companies/${companyId}/uploads/${stamp}-roof.jpg`;
  await putObject(dealKey, DEAL_FILE_BYTES);
  dealFileId = (
    await raw.fileAsset.create({
      data: {
        companyId,
        kind: "photo",
        name: "roof.jpg",
        storageKey: dealKey,
        mimeType: "image/jpeg",
        size: DEAL_FILE_BYTES.length,
        leadId: lead.id,
        uploadedById: people.rep.userId,
      },
      select: { id: true },
    })
  ).id;

  // A RECEIPT, uploaded by accounting through the Bookkeeping screen's action.
  const txn = await raw.transaction.create({
    data: { companyId, date: new Date(), description: "Lumber", amountCents: -12_345, createdById: people.accounting.userId },
    select: { id: true },
  });
  const form = new FormData();
  form.set("transactionId", txn.id);
  form.set("file", new File([RECEIPT_BYTES], "lumber-receipt.pdf", { type: "application/pdf" }));
  current = people.accounting;
  expect(await runInVertical("roofing", () => uploadTransactionAttachmentAction(form))).toEqual({ ok: true });
  receiptId = (
    await raw.fileAsset.findFirstOrThrow({ where: { companyId, transactionId: txn.id }, select: { id: true } })
  ).id;

  // A PAY STUB, attached by posting a paid payroll run to the ledger. The rep
  // is the person being paid.
  const run = await raw.payrollRun.create({
    data: {
      companyId,
      label: `Week ${stamp}`,
      periodStart: new Date(Date.UTC(2026, 0, 5)),
      periodEnd: new Date(Date.UTC(2026, 0, 9, 23, 59, 59, 999)),
      status: "paid",
      paidAt: new Date(Date.UTC(2026, 0, 15)),
    },
    select: { id: true },
  });
  const commission = await raw.commission.create({
    data: {
      companyId,
      projectId: project.id,
      userId: people.rep.userId,
      amount: 250_000,
      baseAmount: 250_000,
      status: "paid",
      label: "Roofing commission",
    },
    select: { id: true },
  });
  await raw.payrollItem.create({
    data: { payrollRunId: run.id, userId: people.rep.userId, commissionId: commission.id, label: "Commission", amount: 250_000 },
  });
  await runInVertical("roofing", () => postRunToBookkeeping(companyId, run.id, people.owner.userId));
  const stub = await raw.fileAsset.findFirst({
    where: { companyId, transaction: { source: `payroll:${run.id}` } },
    select: { id: true, name: true, scope: true, leadId: true, projectId: true, conversationId: true },
  });
  // Attaching the stub is best-effort in post-bookkeeping.ts, so prove it is there.
  expect(stub, "postRunToBookkeeping attached no pay stub").not.toBeNull();
  expect(stub!.name).toMatch(/^Pay stub/);
  expect([stub!.scope, stub!.leadId, stub!.projectId, stub!.conversationId]).toEqual(["company", null, null, null]);
  payStubId = stub!.id;
});

afterAll(async () => {
  // Payroll lines first: the company cascade reaches users before it reaches
  // the items that point at them.
  await raw.payrollItem.deleteMany({ where: { payrollRun: { companyId } } });
  await raw.payrollRun.deleteMany({ where: { companyId } });
  await raw.commission.deleteMany({ where: { companyId } });
  await raw.company.deleteMany({ where: { id: { in: [companyId, otherCompanyId] } } });
  await raw.$disconnect();
});

describe("the matrix these rules rest on", () => {
  it("Bookkeeping read is super_admin and accounting, not admin, manager or rep", () => {
    expect(can(people.owner, "read", "Bookkeeping")).toBe(true);
    expect(can(people.accounting, "read", "Bookkeeping")).toBe(true);
    expect(can(people.admin, "read", "Bookkeeping")).toBe(false);
    expect(can(people.manager, "read", "Bookkeeping")).toBe(false);
    expect(can(people.rep, "read", "Bookkeeping")).toBe(false);
  });
});

describe("a receipt on a transaction", () => {
  it("opens for the super admin", async () => {
    const res = await open(people.owner, receiptId);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(RECEIPT_BYTES)).toBe(true);
  });

  it("opens for accounting, who uploaded it", async () => {
    const res = await open(people.accounting, receiptId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).equals(RECEIPT_BYTES)).toBe(true);
  });

  it("is refused to an admin without Bookkeeping read", async () => {
    expect((await open(people.admin, receiptId)).status).toBe(403);
  });

  it("opens for an admin who has been granted Bookkeeping read", async () => {
    // The rule is the permission, not the role.
    expect((await open(people.adminWithBooks, receiptId)).status).toBe(200);
  });

  it("is refused to a manager and a sales rep", async () => {
    expect((await open(people.manager, receiptId)).status).toBe(403);
    expect((await open(people.rep, receiptId)).status).toBe(403);
  });

  it("is not found for another company's accounting user", async () => {
    expect((await open(people.otherAccounting, receiptId)).status).toBe(404);
  });
});

describe("a pay stub on a payroll transaction", () => {
  it("opens for accounting and the super admin", async () => {
    const res = await open(people.accounting, payStubId);
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect((await open(people.owner, payStubId)).status).toBe(200);
  });

  it("is refused to an admin without Bookkeeping read", async () => {
    expect((await open(people.admin, payStubId)).status).toBe(403);
  });

  it("is refused to a manager, and to the rep it pays", async () => {
    // The rep's own copy comes from /portal/payroll/[id]/paystub/[userId], which
    // checks that it is theirs. The ledger's attachment is the books' copy.
    expect((await open(people.manager, payStubId)).status).toBe(403);
    expect((await open(people.rep, payStubId)).status).toBe(403);
  });

  it("is not found for another company's accounting user", async () => {
    expect((await open(people.otherAccounting, payStubId)).status).toBe(404);
  });
});

describe("an ordinary deal file is unaffected", () => {
  it("still opens for the rep on the deal, and for an admin", async () => {
    const res = await open(people.rep, dealFileId);
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).equals(DEAL_FILE_BYTES)).toBe(true);
    expect((await open(people.admin, dealFileId)).status).toBe(200);
  });

  it("is still refused to a manager with nobody on the deal", async () => {
    expect((await open(people.manager, dealFileId)).status).toBe(403);
  });
});

/* ── DELETING AND MOVING ──────────────────────────────────────────────────
 * The deal folders' generic delete and move actions authorise a file by its
 * deal, and a file with no deal used to pass that check outright. So anyone
 * holding File:update (every admin and manager) could delete or refile a
 * receipt or a pay stub by id. Finance records now need Bookkeeping update.
 *
 * The Bookkeeping screen never uses these actions. It deletes a receipt with
 * its own deleteTransactionAttachmentAction, which is how accounting (holding
 * no File grant at all) removes one. The last test proves that path still works.
 *
 * Every case works on a fresh copy of the real row, so a refusal that fails
 * cannot take the shared receipt or stub down with it.
 */
describe("the generic file actions leave finance records alone", () => {
  /** A new row identical to `fileId`: same transaction, same stored bytes. */
  async function copyOf(fileId: string) {
    const f = await raw.fileAsset.findUniqueOrThrow({ where: { id: fileId } });
    return (
      await raw.fileAsset.create({
        data: {
          companyId: f.companyId,
          kind: f.kind,
          scope: f.scope,
          name: f.name,
          storageKey: f.storageKey,
          mimeType: f.mimeType,
          size: f.size,
          transactionId: f.transactionId,
          uploadedById: f.uploadedById,
        },
        select: { id: true },
      })
    ).id;
  }

  function as<T>(who: Person, fn: () => Promise<T>) {
    current = who;
    return runInVertical("roofing", fn);
  }

  const records = [
    ["receipt", () => receiptId],
    ["pay stub", () => payStubId],
  ] as const;

  for (const [label, source] of records) {
    it(`an admin and a manager cannot delete a ${label}`, async () => {
      for (const who of [people.admin, people.manager]) {
        const id = await copyOf(source());
        const res = await as(who, () => deleteFileAction(id));
        expect(res.ok, `${who.role} deleted a ${label}`).toBe(false);
        expect(res.ok ? "" : res.error).toMatch(/Bookkeeping/);
        expect(await raw.fileAsset.count({ where: { id } })).toBe(1);
      }
    });

    it(`an admin and a manager cannot move a ${label} into a deal folder`, async () => {
      for (const who of [people.admin, people.manager]) {
        const id = await copyOf(source());
        const res = await as(who, () => moveFileAction(id, "contract"));
        expect(res.ok, `${who.role} moved a ${label}`).toBe(false);
        expect(res.ok ? "" : res.error).toMatch(/Bookkeeping/);
        expect((await raw.fileAsset.findUniqueOrThrow({ where: { id } })).category).toBeNull();
      }
    });
  }

  it("the super admin, who holds Bookkeeping update, is not blocked by the guard", async () => {
    const id = await copyOf(receiptId);
    expect(await as(people.owner, () => deleteFileAction(id))).toEqual({ ok: true });
    expect(await raw.fileAsset.count({ where: { id } })).toBe(0);
  });

  it("accounting still deletes a receipt from the Bookkeeping screen's own action", async () => {
    const id = await copyOf(receiptId);
    expect(await as(people.accounting, () => deleteTransactionAttachmentAction(id))).toEqual({ ok: true });
    expect(await raw.fileAsset.count({ where: { id } })).toBe(0);
  });
});
