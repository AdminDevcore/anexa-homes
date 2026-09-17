import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { PrismaClient } from "@prisma/client";
import { TEST_DATABASE_URL } from "@/server/vertical/__tests__/global-setup";
import {
  createPayee,
  updatePayeeBankDetails,
  listPayees,
  bankDetailsForPayment,
  setPayeeActive,
  isValidRoutingNumber,
  COOLING_OFF_HOURS,
} from "../payees";

/**
 * PAYEES — where money goes.
 *
 * Two controls carry this module, and both fail silently if they are wrong:
 *
 *   • THE COOLING-OFF PERIOD. The commonest fraud against a business like this
 *     is not a hacked bank account: it is an email that looks like a known
 *     subcontractor saying their bank has changed. Somebody updates the details
 *     and pays the invoice that afternoon. The delay is the whole control, and
 *     it applies to newly CREATED payees too — otherwise an attacker simply
 *     creates rather than edits.
 *
 *   • THE ROUTING CHECKSUM. A transposed digit should be caught at the
 *     keyboard, not after an ACH file reaches a bank that does not exist, or
 *     one that does.
 *
 * And one property with no second chance: full account numbers must never be
 * readable in the row or returned by a listing.
 */

process.env.SOLAR_VERTICAL_ENABLED = "1";

const db = new PrismaClient({ datasources: { db: { url: TEST_DATABASE_URL } } });

let companyId: string;
let userId: string;
let vendorId: string;

const rand = () => Math.random().toString(36).slice(2, 8);

const HOUR = 3_600_000;
const afterCooling = () => new Date(Date.now() + (COOLING_OFF_HOURS + 1) * HOUR);

/** A real, checksum-valid routing number (JPMorgan Chase). */
const GOOD_ROUTING = "021000021";
const ACCOUNT = "123456789";

const bank = { routingNumber: GOOD_ROUTING, accountNumber: ACCOUNT, accountType: "checking" as const };

beforeEach(async () => {
  const company = await db.company.create({
    data: { name: "Payee Co", slug: `pye-${process.pid}-${Date.now()}-${rand()}` },
  });
  companyId = company.id;
  userId = (
    await db.user.create({
      data: {
        companyId, email: `o-${Date.now()}-${Math.random()}@t.local`, passwordHash: "x",
        firstName: "Ola", lastName: "Owner", role: "super_admin", verticals: ["roofing"],
      },
      select: { id: true },
    })
  ).id;
  vendorId = (await db.bookkeepingVendor.create({ data: { companyId, name: "Ace Supply" } })).id;
});

afterAll(async () => {
  await db.$disconnect();
});

const aPayee = (over: Partial<Parameters<typeof createPayee>[0]> = {}) =>
  createPayee({ companyId, name: `Ace ${rand()}`, bank, actorUserId: userId, ...over });

describe("the routing number checksum", () => {
  /**
   * Real routing numbers, checked against the published ABA rule rather than
   * against our own arithmetic.
   */
  it("accepts genuine routing numbers", () => {
    for (const rn of ["021000021", "121000248", "011401533"]) {
      expect(isValidRoutingNumber(rn), `${rn} should be valid`).toBe(true);
    }
  });

  /** The error a person actually makes: one digit off, or two swapped. */
  it("rejects a single altered digit", () => {
    expect(isValidRoutingNumber("021000022")).toBe(false);
  });

  it("rejects anything that is not nine digits", () => {
    expect(isValidRoutingNumber("02100002")).toBe(false);
    expect(isValidRoutingNumber("0210000211")).toBe(false);
    expect(isValidRoutingNumber("abcdefghi")).toBe(false);
    expect(isValidRoutingNumber("")).toBe(false);
  });

  it("ignores spacing people type in", () => {
    expect(isValidRoutingNumber("021 000 021")).toBe(true);
    expect(isValidRoutingNumber("021-000-021")).toBe(true);
  });

  it("refuses to store an invalid one", async () => {
    const res = await aPayee({ bank: { ...bank, routingNumber: "021000022" } });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("routing number");
  });

  it("refuses an implausible account number", async () => {
    expect((await aPayee({ bank: { ...bank, accountNumber: "12" } })).ok).toBe(false);
    expect((await aPayee({ bank: { ...bank, accountNumber: "1234567890123456789" } })).ok).toBe(false);
    expect((await aPayee({ bank: { ...bank, accountNumber: "not-digits" } })).ok).toBe(false);
  });
});

describe("what is stored, and what is readable", () => {
  it("never keeps the account number in plain text", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    const row = await db.payee.findFirstOrThrow({ where: { id: res.payeeId } });
    expect(row.accountNumberEnc).not.toContain(ACCOUNT);
    expect(row.routingNumberEnc).not.toContain(GOOD_ROUTING);
    expect(row.accountLast4).toBe("6789");
  });

  /** A field that is never loaded cannot be logged, serialised into an error,
   * or leaked by a caller spreading the row into a response. */
  it("lists payees with the masked tail and nothing more", async () => {
    const res = await aPayee({ name: "Ace Supply Co", vendorId });
    if (!res.ok) throw new Error(res.error);

    const rows = await listPayees(companyId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    expect(row.accountLast4).toBe("6789");
    expect(row.vendorName).toBe("Ace Supply");
    expect(JSON.stringify(row)).not.toContain(ACCOUNT);
    expect(JSON.stringify(row)).not.toContain(GOOD_ROUTING);
  });

  it("refuses a duplicate name and a vendor from another company", async () => {
    const name = `Ace ${rand()}`;
    expect((await aPayee({ name })).ok).toBe(true);
    expect((await aPayee({ name })).ok).toBe(false);

    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const foreign = await db.bookkeepingVendor.create({ data: { companyId: other.id, name: "Foreign" } });
    expect((await aPayee({ vendorId: foreign.id })).ok).toBe(false);
  });
});

describe("the cooling-off period", () => {
  /** "Add a new payee and pay it immediately" is the same fraud with one extra
   * step, so the clock starts on creation too. */
  it("refuses to pay a payee that was only just created", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    const details = await bankDetailsForPayment({ companyId, payeeId: res.payeeId });
    expect(details.ok).toBe(false);
    if (!details.ok) {
      expect(details.error).toContain("cannot be paid");
      // The advice matters: confirming on a number from the same email is how
      // people get caught.
      expect(details.error).toContain("number you already had");
    }
  });

  it("pays it once the period has passed", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    const details = await bankDetailsForPayment({
      companyId, payeeId: res.payeeId, at: afterCooling(),
    });
    expect(details.ok).toBe(true);
    if (!details.ok) return;
    expect(details.bank.routingNumber).toBe(GOOD_ROUTING);
    expect(details.bank.accountNumber).toBe(ACCOUNT);
  });

  /** Deciding which edits are "safe enough" to skip the delay is how a control
   * gets worn away one exception at a time. */
  it("restarts the clock when the details change", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    /**
     * Age the payee first, which is also the real case: the subcontractor we
     * have paid for a year, whose bank has supposedly just changed.
     *
     * Necessary rather than decorative. Creation and the edit both stamp the
     * clock at real "now", so a test that merely moves `at` forward cannot tell
     * the two windows apart — by the time the first has expired, so has the
     * second, and the assertion proves nothing.
     */
    await db.payee.update({
      where: { id: res.payeeId },
      data: { bankDetailsUpdatedAt: new Date(Date.now() - 2 * 24 * HOUR) },
    });
    expect((await bankDetailsForPayment({ companyId, payeeId: res.payeeId })).ok).toBe(true);

    const changed = await updatePayeeBankDetails({
      companyId,
      payeeId: res.payeeId,
      bank: { ...bank, accountNumber: "987654321" },
      actorUserId: userId,
    });
    expect(changed.ok).toBe(true);

    // An established payee is suddenly unpayable. That is the entire control.
    const after = await bankDetailsForPayment({ companyId, payeeId: res.payeeId });
    expect(after.ok).toBe(false);
    if (!after.ok) expect(after.error).toContain("cannot be paid");
  });

  it("reports the wait in the listing", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    expect((await listPayees(companyId))[0]).toMatchObject({ cooling: true });
    expect((await listPayees(companyId, afterCooling()))[0]).toMatchObject({ cooling: false });
  });
});

describe("what cannot be paid at all", () => {
  it("refuses a payee with no bank details", async () => {
    const res = await aPayee({ bank: null });
    if (!res.ok) throw new Error(res.error);

    const details = await bankDetailsForPayment({
      companyId, payeeId: res.payeeId, at: afterCooling(),
    });
    expect(details.ok).toBe(false);
    if (!details.ok) expect(details.error).toContain("no bank details");
  });

  /** Retired, never deleted: money that moved must stay answerable to who
   * received it. */
  it("refuses a retired payee but keeps the row", async () => {
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    expect((await setPayeeActive({ companyId, payeeId: res.payeeId, active: false })).ok).toBe(true);

    const details = await bankDetailsForPayment({
      companyId, payeeId: res.payeeId, at: afterCooling(),
    });
    expect(details.ok).toBe(false);
    if (!details.ok) expect(details.error).toContain("no longer active");

    expect(await db.payee.count({ where: { id: res.payeeId } })).toBe(1);
  });

  it("refuses a payee belonging to another company", async () => {
    const other = await db.company.create({
      data: { name: "Other", slug: `oth-${process.pid}-${Date.now()}-${rand()}` },
    });
    const res = await aPayee();
    if (!res.ok) throw new Error(res.error);

    const details = await bankDetailsForPayment({
      companyId: other.id, payeeId: res.payeeId, at: afterCooling(),
    });
    expect(details.ok).toBe(false);
  });
});
