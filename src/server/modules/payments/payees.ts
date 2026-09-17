import type { PayeeAccountType } from "@prisma/client";
import { prisma } from "@/server/db/client";
import { encryptField, decryptField } from "@/server/lib/crypto";

/**
 * PAYEES — where money goes, kept separate from who we owe.
 *
 * A vendor is a party we owe; a payee is a set of bank details. Keeping them
 * apart means correcting bank details never rewrites bill history, and one
 * vendor can be paid different ways over time without any bill changing.
 *
 * ── THE COOLING-OFF PERIOD IS THE POINT OF THIS MODULE ──────────────────────
 * The commonest fraud against a business like this one is not a hacked bank
 * account. It is an email that appears to come from a known subcontractor
 * saying their bank has changed, followed by an invoice. Somebody updates the
 * details and pays it the same afternoon, and the money is gone before anybody
 * reads the email a second time.
 *
 * So changed bank details start a clock, and payments are refused until it
 * expires. The delay is the control: it costs a legitimate vendor a day and it
 * costs a thief the entire scheme, because the window where nobody has looked
 * twice is exactly what they are relying on.
 *
 * A NEWLY CREATED payee is treated the same way, deliberately. "Add a new payee
 * and pay it immediately" is the same fraud with one extra step, and a
 * cooling-off period that only applies to edits simply tells an attacker to
 * create rather than edit.
 *
 * ── THE ROUTING NUMBER IS CHECKED, NOT JUST STORED ──────────────────────────
 * ABA routing numbers carry a checksum. Validating it catches a transposed
 * digit here, at the keyboard, rather than after an ACH file has gone out to a
 * bank that does not exist or — worse — one that does.
 *
 * ── WHAT NEVER LEAVES THIS MODULE ───────────────────────────────────────────
 * Full account and routing numbers are decrypted in exactly one function,
 * `bankDetailsForPayment`, immediately before a transfer. Every listing returns
 * the masked tail and nothing else. They are never logged and never returned to
 * a browser.
 */

/** How long changed bank details must sit before they can be paid. */
export const COOLING_OFF_HOURS = 24;

const HOUR_MS = 3_600_000;

export type BankDetailsInput = {
  routingNumber: string;
  accountNumber: string;
  accountType: PayeeAccountType;
};

export type PayeeResult = { ok: true; payeeId: string } | { ok: false; error: string };

/**
 * The ABA checksum, which is the whole reason to validate rather than just
 * store: 3·(d1+d4+d7) + 7·(d2+d5+d8) + 1·(d3+d6+d9) ≡ 0 (mod 10).
 *
 * It catches every single-digit error and most transpositions — which is
 * precisely the mistake a person makes reading a number off a form.
 */
export function isValidRoutingNumber(value: string): boolean {
  const digits = value.replace(/\s|-/g, "");
  if (!/^\d{9}$/.test(digits)) return false;

  const d = [...digits].map(Number);
  const sum =
    3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + 1 * (d[2] + d[5] + d[8]);
  return sum % 10 === 0;
}

function validateBank(bank: BankDetailsInput): { ok: true } | { ok: false; error: string } {
  if (!isValidRoutingNumber(bank.routingNumber)) {
    return { ok: false, error: "That routing number is not valid. Check it against the vendor's form." };
  }
  const account = bank.accountNumber.replace(/\s|-/g, "");
  if (!/^\d{4,17}$/.test(account)) {
    return { ok: false, error: "An account number is between 4 and 17 digits." };
  }
  return { ok: true };
}

const clean = (v: string) => v.replace(/\s|-/g, "");

export async function createPayee(args: {
  companyId: string;
  name: string;
  email?: string | null;
  vendorId?: string | null;
  bank?: BankDetailsInput | null;
  actorUserId: string | null;
}): Promise<PayeeResult> {
  const name = args.name.trim();
  if (!name) return { ok: false, error: "Give the payee a name." };

  if (args.vendorId) {
    const vendor = await prisma.bookkeepingVendor.findFirst({
      where: { id: args.vendorId, companyId: args.companyId },
      select: { id: true },
    });
    if (!vendor) return { ok: false, error: "That vendor is not on this company." };
  }

  const clash = await prisma.payee.findFirst({
    where: { companyId: args.companyId, name },
    select: { id: true },
  });
  if (clash) return { ok: false, error: `A payee called ${name} already exists.` };

  let bankFields = {};
  if (args.bank) {
    const valid = validateBank(args.bank);
    if (!valid.ok) return valid;
    const account = clean(args.bank.accountNumber);
    bankFields = {
      routingNumberEnc: encryptField(clean(args.bank.routingNumber)),
      accountNumberEnc: encryptField(account),
      // The literal last four digits: the column says `accountLast4`, and a
      // formatter that renders its own mask would put bullets in a field other
      // code will reasonably assume is four digits.
      accountLast4: account.slice(-4),
      accountType: args.bank.accountType,
      // The clock starts on creation too — see the header.
      bankDetailsUpdatedAt: new Date(),
      bankDetailsUpdatedById: args.actorUserId,
    };
  }

  const payee = await prisma.payee.create({
    data: {
      companyId: args.companyId,
      name,
      email: args.email ?? null,
      vendorId: args.vendorId ?? null,
      ...bankFields,
    },
    select: { id: true },
  });
  return { ok: true, payeeId: payee.id };
}

/**
 * Change where a payee's money goes.
 *
 * Always restarts the cooling-off clock, even if the caller believes the change
 * is innocuous. Deciding which edits are "safe enough" to skip the delay is how
 * the control gets worn away one exception at a time.
 */
export async function updatePayeeBankDetails(args: {
  companyId: string;
  payeeId: string;
  bank: BankDetailsInput;
  actorUserId: string | null;
}): Promise<PayeeResult> {
  const payee = await prisma.payee.findFirst({
    where: { id: args.payeeId, companyId: args.companyId },
    select: { id: true },
  });
  if (!payee) return { ok: false, error: "That payee is not on this company." };

  const valid = validateBank(args.bank);
  if (!valid.ok) return valid;

  const account = clean(args.bank.accountNumber);
  await prisma.payee.update({
    where: { id: payee.id },
    data: {
      routingNumberEnc: encryptField(clean(args.bank.routingNumber)),
      accountNumberEnc: encryptField(account),
      // The literal last four digits: the column says `accountLast4`, and a
      // formatter that renders its own mask would put bullets in a field other
      // code will reasonably assume is four digits.
      accountLast4: account.slice(-4),
      accountType: args.bank.accountType,
      bankDetailsUpdatedAt: new Date(),
      bankDetailsUpdatedById: args.actorUserId,
    },
  });
  return { ok: true, payeeId: payee.id };
}

export type PayeeRow = {
  id: string;
  name: string;
  email: string | null;
  vendorId: string | null;
  vendorName: string | null;
  accountLast4: string | null;
  accountType: PayeeAccountType | null;
  active: boolean;
  /** Null when there are no bank details at all. */
  payableAt: string | null;
  /** True while the cooling-off period is still running. */
  cooling: boolean;
};

/**
 * Every payee, with the masked tail and nothing more.
 *
 * The encrypted columns are not selected at all — not selected and then
 * dropped, but never read. A field that is never loaded cannot be logged by
 * accident, serialised into an error, or leaked by a future caller spreading
 * the row into a response.
 */
export async function listPayees(companyId: string, at: Date = new Date()): Promise<PayeeRow[]> {
  const rows = await prisma.payee.findMany({
    where: { companyId },
    orderBy: [{ active: "desc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      email: true,
      vendorId: true,
      accountLast4: true,
      accountType: true,
      active: true,
      bankDetailsUpdatedAt: true,
      vendor: { select: { name: true } },
    },
  });

  return rows.map((p) => {
    const payableFrom = p.bankDetailsUpdatedAt
      ? new Date(p.bankDetailsUpdatedAt.getTime() + COOLING_OFF_HOURS * HOUR_MS)
      : null;
    return {
      id: p.id,
      name: p.name,
      email: p.email,
      vendorId: p.vendorId,
      vendorName: p.vendor?.name ?? null,
      accountLast4: p.accountLast4,
      accountType: p.accountType,
      active: p.active,
      payableAt: payableFrom ? payableFrom.toISOString() : null,
      cooling: payableFrom !== null && payableFrom.getTime() > at.getTime(),
    };
  });
}

export type BankDetails = {
  routingNumber: string;
  accountNumber: string;
  accountType: PayeeAccountType;
  payeeName: string;
};

/**
 * THE ONLY PLACE FULL BANK DETAILS ARE DECRYPTED.
 *
 * Enforces the cooling-off period, so the delay cannot be bypassed by a caller
 * that forgets to check it. Putting the rule here rather than in the payment
 * flow means it holds for every future caller as well, which is the same reason
 * the department tag was fixed at the posting door.
 */
export async function bankDetailsForPayment(args: {
  companyId: string;
  payeeId: string;
  at?: Date;
}): Promise<{ ok: true; bank: BankDetails } | { ok: false; error: string }> {
  const at = args.at ?? new Date();
  const payee = await prisma.payee.findFirst({
    where: { id: args.payeeId, companyId: args.companyId },
    select: {
      name: true,
      active: true,
      routingNumberEnc: true,
      accountNumberEnc: true,
      accountType: true,
      bankDetailsUpdatedAt: true,
    },
  });
  if (!payee) return { ok: false, error: "That payee is not on this company." };
  if (!payee.active) return { ok: false, error: "That payee is no longer active." };
  if (!payee.routingNumberEnc || !payee.accountNumberEnc || !payee.accountType) {
    return { ok: false, error: "This payee has no bank details." };
  }

  if (payee.bankDetailsUpdatedAt) {
    const payableFrom = payee.bankDetailsUpdatedAt.getTime() + COOLING_OFF_HOURS * HOUR_MS;
    if (payableFrom > at.getTime()) {
      const hours = Math.max(1, Math.ceil((payableFrom - at.getTime()) / HOUR_MS));
      return {
        ok: false,
        error:
          `These bank details changed recently and cannot be paid for another ${hours} ` +
          `hour${hours === 1 ? "" : "s"}. If the change was expected, confirm it with the payee by phone ` +
          `on a number you already had — not one from the email that asked for it.`,
      };
    }
  }

  const routingNumber = decryptField(payee.routingNumberEnc, "payee routing number");
  const accountNumber = decryptField(payee.accountNumberEnc, "payee account number");
  if (!routingNumber || !accountNumber) {
    return { ok: false, error: "This payee's bank details cannot be read." };
  }

  return {
    ok: true,
    bank: { routingNumber, accountNumber, accountType: payee.accountType, payeeName: payee.name },
  };
}

/**
 * Retire a payee. Never a delete: `Payment.payee` is Restrict, because money
 * that moved must stay answerable to who received it.
 */
export async function setPayeeActive(args: {
  companyId: string;
  payeeId: string;
  active: boolean;
}): Promise<PayeeResult> {
  const payee = await prisma.payee.findFirst({
    where: { id: args.payeeId, companyId: args.companyId },
    select: { id: true },
  });
  if (!payee) return { ok: false, error: "That payee is not on this company." };

  await prisma.payee.update({ where: { id: payee.id }, data: { active: args.active } });
  return { ok: true, payeeId: payee.id };
}
